//! Loopback-only PMTiles server used by the offline mobile demo.
//!
//! It deliberately has no upstream URL, cache, telemetry, or proxy mode. The
//! only public surface is a small HTTP server over the two files bundled by
//! the application: `map.pmtiles` and `style.json`.

use std::cell::RefCell;
use std::ffi::{CStr, CString};
use std::fs::{self, File};
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use flate2::read::GzDecoder;
use memmap2::Mmap;
use thiserror::Error;
use tiny_http::{Header, Method, Response, Server, StatusCode};

const PMTILES_HEADER_BYTES: usize = 127;
const MAX_DIRECTORY_DEPTH: usize = 4;
// Directories for the bundled offline fixture are kilobyte-scale. One MiB
// leaves ample writer headroom while bounding gzip amplification and the
// directory-entry allocation that follows decompression.
const MAX_DIRECTORY_DECOMPRESSED_BYTES: usize = 1024 * 1024;

#[derive(Debug, Error)]
pub enum TileServerError {
    #[error("tile server only binds loopback, received {0}")]
    NonLoopbackBind(Ipv4Addr),
    #[error("missing required asset: {0}")]
    MissingAsset(String),
    #[error("asset path is not a directory: {0}")]
    InvalidRoot(String),
    #[error("could not bind loopback tile server: {0}")]
    Bind(String),
    #[error("could not open PMTiles archive: {0}")]
    Archive(#[from] ArchiveError),
}

/// Immutable, validated configuration. There is intentionally no host field.
#[derive(Debug, Clone)]
pub struct TileServerConfig {
    root: PathBuf,
    port: u16,
}

impl TileServerConfig {
    pub fn new(root: impl AsRef<Path>, port: u16) -> Result<Self, TileServerError> {
        Self::with_bind(root, Ipv4Addr::LOCALHOST, port)
    }

    pub fn with_bind(
        root: impl AsRef<Path>,
        bind_ip: Ipv4Addr,
        port: u16,
    ) -> Result<Self, TileServerError> {
        if !bind_ip.is_loopback() {
            return Err(TileServerError::NonLoopbackBind(bind_ip));
        }
        let root = root.as_ref().to_path_buf();
        if !root.is_dir() {
            return Err(TileServerError::InvalidRoot(root.display().to_string()));
        }
        for name in ["map.pmtiles", "style.json"] {
            let path = root.join(name);
            if !path.is_file() {
                return Err(TileServerError::MissingAsset(path.display().to_string()));
            }
        }
        Ok(Self { root, port })
    }

    #[must_use]
    pub fn bind_ip(&self) -> Ipv4Addr {
        Ipv4Addr::LOCALHOST
    }
}

/// A running local server. Dropping it terminates its worker thread.
pub struct LocalTileServer {
    address: SocketAddr,
    stopping: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl LocalTileServer {
    #[must_use]
    pub fn address(&self) -> SocketAddr {
        self.address
    }

    pub fn stop(mut self) {
        self.shutdown();
    }

    fn shutdown(&mut self) {
        self.stopping.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

impl Drop for LocalTileServer {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Starts a server bound to `127.0.0.1`. The historical name is retained for
/// a compact FFI-facing API; it serves requests until `stop` or drop.
pub fn serve_once(config: TileServerConfig) -> Result<LocalTileServer, TileServerError> {
    let archive = Arc::new(PmtilesArchive::open(&config.root.join("map.pmtiles"))?);
    let style = fs::read_to_string(config.root.join("style.json")).map_err(|_| {
        TileServerError::MissingAsset(config.root.join("style.json").display().to_string())
    })?;
    let server = Server::http(SocketAddr::new(
        IpAddr::V4(Ipv4Addr::LOCALHOST),
        config.port,
    ))
    .map_err(|error| TileServerError::Bind(error.to_string()))?;
    let address = server
        .server_addr()
        .to_ip()
        .ok_or_else(|| TileServerError::Bind("server address was not IP".into()))?;
    let stopping = Arc::new(AtomicBool::new(false));
    let stop_flag = Arc::clone(&stopping);
    let worker = thread::Builder::new()
        .name("offline-pmtiles".into())
        .spawn(move || {
            while !stop_flag.load(Ordering::Acquire) {
                match server.recv_timeout(Duration::from_millis(50)) {
                    Ok(Some(request)) => handle_request(request, &archive, &style, address.port()),
                    Ok(None) => {}
                    Err(_) => break,
                }
            }
        })
        .map_err(|error| TileServerError::Bind(error.to_string()))?;
    Ok(LocalTileServer {
        address,
        stopping,
        worker: Some(worker),
    })
}

fn handle_request(request: tiny_http::Request, archive: &PmtilesArchive, style: &str, port: u16) {
    if request.method() != &Method::Get {
        let _ = request
            .respond(Response::from_string("method not allowed").with_status_code(StatusCode(405)));
        return;
    }
    let path = request.url().split('?').next().unwrap_or("/");
    let response = match path {
        "/health" => Response::from_string("ok"),
        "/style.json" => json_response(style.replace("$PORT", &port.to_string()).into_bytes()),
        "/map.pmtiles" => raw_archive_response(request.headers(), archive),
        _ => tile_response(path, archive),
    };
    let _ = request.respond(response);
}

fn json_response(body: Vec<u8>) -> Response<std::io::Cursor<Vec<u8>>> {
    let mut response = Response::from_data(body);
    response.add_header(header("Content-Type", "application/json; charset=utf-8"));
    response
}

fn raw_archive_response(
    headers: &[Header],
    archive: &PmtilesArchive,
) -> Response<std::io::Cursor<Vec<u8>>> {
    let full = archive.bytes();
    let range = headers
        .iter()
        .find(|header| header.field.equiv("Range"))
        .map(|header| header.value.as_str());
    let Some(range) = range else {
        return binary_response(full.to_vec(), StatusCode(200), None);
    };
    let Ok((start, end)) = parse_range(range, full.len()) else {
        return Response::from_string("range not satisfiable").with_status_code(StatusCode(416));
    };
    binary_response(
        full[start..=end].to_vec(),
        StatusCode(206),
        Some(format!("bytes {start}-{end}/{}", full.len())),
    )
}

fn tile_response(path: &str, archive: &PmtilesArchive) -> Response<std::io::Cursor<Vec<u8>>> {
    let Some((z, x, y)) = parse_tile_path(path) else {
        return Response::from_string("not found").with_status_code(StatusCode(404));
    };
    match archive.tile(z, x, y) {
        Ok(Some(tile)) => {
            let mut response = binary_response(tile.bytes.to_vec(), StatusCode(200), None);
            response.add_header(header("Content-Type", "application/x-protobuf"));
            if let Some(encoding) = tile.compression.content_encoding() {
                response.add_header(header("Content-Encoding", encoding));
            }
            response
        }
        Ok(None) => Response::from_string("tile not found").with_status_code(StatusCode(404)),
        Err(_) => Response::from_string("invalid archive").with_status_code(StatusCode(500)),
    }
}

fn binary_response(
    body: Vec<u8>,
    status: StatusCode,
    content_range: Option<String>,
) -> Response<std::io::Cursor<Vec<u8>>> {
    let mut response = Response::from_data(body).with_status_code(status);
    response.add_header(header("Accept-Ranges", "bytes"));
    if let Some(value) = content_range {
        response.add_header(header("Content-Range", &value));
    }
    response
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name, value).expect("static HTTP header")
}

fn parse_range(value: &str, full_len: usize) -> Result<(usize, usize), ()> {
    let raw = value.strip_prefix("bytes=").ok_or(())?;
    if raw.contains(',') {
        return Err(());
    }
    let (start, end) = raw.split_once('-').ok_or(())?;
    let start = start.parse::<usize>().map_err(|_| ())?;
    let end = if end.is_empty() {
        full_len.checked_sub(1).ok_or(())?
    } else {
        end.parse::<usize>().map_err(|_| ())?
    };
    if start > end || end >= full_len {
        return Err(());
    }
    Ok((start, end))
}

fn parse_tile_path(path: &str) -> Option<(u8, u32, u32)> {
    let mut parts = path.strip_prefix("/tiles/")?.split('/');
    let z = parts.next()?.parse().ok()?;
    let x = parts.next()?.parse().ok()?;
    let y = parts.next()?.strip_suffix(".pbf")?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((z, x, y))
}

#[derive(Debug, Error)]
pub enum ArchiveError {
    #[error("could not read PMTiles file: {0}")]
    Io(#[from] std::io::Error),
    #[error("PMTiles header is invalid")]
    InvalidHeader,
    #[error("PMTiles uses unsupported compression")]
    UnsupportedCompression,
    #[error("PMTiles directory is invalid")]
    InvalidDirectory,
    #[error("PMTiles directory exceeds the safe decompressed size limit")]
    DirectoryTooLarge,
}

struct PmtilesArchive {
    map: Mmap,
    leaf_directories: Range<usize>,
    tile_data: Range<usize>,
    internal_compression: u8,
    tile_compression: TileCompression,
    root: Vec<DirectoryEntry>,
}

#[derive(Clone, Copy)]
enum TileCompression {
    None,
    Gzip,
}

impl TileCompression {
    fn from_header(value: u8) -> Result<Self, ArchiveError> {
        match value {
            1 => Ok(Self::None),
            2 => Ok(Self::Gzip),
            _ => Err(ArchiveError::UnsupportedCompression),
        }
    }

    fn content_encoding(self) -> Option<&'static str> {
        match self {
            Self::None => None,
            Self::Gzip => Some("gzip"),
        }
    }
}

struct Tile<'a> {
    bytes: &'a [u8],
    compression: TileCompression,
}

#[derive(Clone, Copy)]
struct DirectoryEntry {
    id: u64,
    offset: u64,
    length: u32,
    run: u32,
}

impl PmtilesArchive {
    fn open(path: &Path) -> Result<Self, ArchiveError> {
        let file = File::open(path)?;
        // SAFETY: the mapping is read-only; no reference outlives `self.map`.
        let map = unsafe { Mmap::map(&file)? };
        if map.len() < PMTILES_HEADER_BYTES || &map[..7] != b"PMTiles" || map[7] != 3 {
            return Err(ArchiveError::InvalidHeader);
        }
        let root = header_range(&map, 8, 16)?;
        let leaf_directories = header_range(&map, 40, 48)?;
        let tile_data = header_range(&map, 56, 64)?;
        let internal_compression = map[97];
        let tile_compression = TileCompression::from_header(map[98])?;
        let root_slice = map.get(root).ok_or(ArchiveError::InvalidHeader)?;
        let root_data = decompress_directory(root_slice, internal_compression)?;
        Ok(Self {
            map,
            leaf_directories,
            tile_data,
            internal_compression,
            tile_compression,
            root: parse_directory(&root_data)?,
        })
    }

    fn bytes(&self) -> &[u8] {
        &self.map
    }

    fn tile(&self, z: u8, x: u32, y: u32) -> Result<Option<Tile<'_>>, ArchiveError> {
        let Some(tile_id) = zxy_to_id(z, x, y) else {
            return Ok(None);
        };
        let mut directory = self.root.clone();
        for depth in 0..MAX_DIRECTORY_DEPTH {
            let Some(entry) = locate(&directory, tile_id).copied() else {
                return Ok(None);
            };
            if entry.run > 0 {
                if tile_id >= entry.id.saturating_add(u64::from(entry.run)) {
                    return Ok(None);
                }
                return Ok(Some(Tile {
                    bytes: self.data(entry.offset, entry.length)?,
                    compression: self.tile_compression,
                }));
            }
            if depth + 1 == MAX_DIRECTORY_DEPTH {
                return Err(ArchiveError::InvalidDirectory);
            }
            let leaf_bytes = self.leaf_directory(entry.offset, entry.length)?;
            let leaf_data = decompress_directory(leaf_bytes, self.internal_compression)?;
            directory = parse_directory(&leaf_data)?;
        }
        Err(ArchiveError::InvalidDirectory)
    }

    fn leaf_directory(&self, offset: u64, length: u32) -> Result<&[u8], ArchiveError> {
        self.relative_data(&self.leaf_directories, offset, length)
    }

    fn data(&self, offset: u64, length: u32) -> Result<&[u8], ArchiveError> {
        self.relative_data(&self.tile_data, offset, length)
    }

    fn relative_data(
        &self,
        region: &Range<usize>,
        offset: u64,
        length: u32,
    ) -> Result<&[u8], ArchiveError> {
        let offset = usize::try_from(offset).map_err(|_| ArchiveError::InvalidDirectory)?;
        let length = usize::try_from(length).map_err(|_| ArchiveError::InvalidDirectory)?;
        let start = region
            .start
            .checked_add(offset)
            .ok_or(ArchiveError::InvalidDirectory)?;
        let end = start
            .checked_add(length)
            .ok_or(ArchiveError::InvalidDirectory)?;
        if end > region.end {
            return Err(ArchiveError::InvalidDirectory);
        }
        self.map
            .get(start..end)
            .ok_or(ArchiveError::InvalidDirectory)
    }
}

fn header_range(
    bytes: &[u8],
    offset_field: usize,
    length_field: usize,
) -> Result<Range<usize>, ArchiveError> {
    let offset =
        usize::try_from(number(bytes, offset_field)?).map_err(|_| ArchiveError::InvalidHeader)?;
    let length =
        usize::try_from(number(bytes, length_field)?).map_err(|_| ArchiveError::InvalidHeader)?;
    let end = offset
        .checked_add(length)
        .ok_or(ArchiveError::InvalidHeader)?;
    if end > bytes.len() {
        return Err(ArchiveError::InvalidHeader);
    }
    Ok(offset..end)
}

fn number(bytes: &[u8], offset: usize) -> Result<u64, ArchiveError> {
    Ok(u64::from_le_bytes(
        bytes
            .get(offset..offset + 8)
            .ok_or(ArchiveError::InvalidHeader)?
            .try_into()
            .map_err(|_| ArchiveError::InvalidHeader)?,
    ))
}

fn decompress_directory(bytes: &[u8], compression: u8) -> Result<Vec<u8>, ArchiveError> {
    match compression {
        1 => {
            if bytes.len() > MAX_DIRECTORY_DECOMPRESSED_BYTES {
                return Err(ArchiveError::DirectoryTooLarge);
            }
            Ok(bytes.to_vec())
        }
        2 => {
            let mut result = Vec::new();
            let output_limit = u64::try_from(MAX_DIRECTORY_DECOMPRESSED_BYTES)
                .expect("directory limit fits u64")
                + 1;
            GzDecoder::new(bytes)
                .take(output_limit)
                .read_to_end(&mut result)?;
            if result.len() > MAX_DIRECTORY_DECOMPRESSED_BYTES {
                return Err(ArchiveError::DirectoryTooLarge);
            }
            Ok(result)
        }
        _ => Err(ArchiveError::UnsupportedCompression),
    }
}

fn parse_directory(bytes: &[u8]) -> Result<Vec<DirectoryEntry>, ArchiveError> {
    let mut offset = 0;
    let count = usize::try_from(read_varint(bytes, &mut offset)?)
        .map_err(|_| ArchiveError::InvalidDirectory)?;
    let remaining = bytes.len().saturating_sub(offset);
    if count > remaining / 4 {
        return Err(ArchiveError::InvalidDirectory);
    }
    let mut entries = Vec::with_capacity(count);
    let mut last_id = 0_u64;
    for _ in 0..count {
        last_id = last_id
            .checked_add(read_varint(bytes, &mut offset)?)
            .ok_or(ArchiveError::InvalidDirectory)?;
        entries.push(DirectoryEntry {
            id: last_id,
            offset: 0,
            length: 0,
            run: 0,
        });
    }
    for entry in &mut entries {
        entry.run = u32::try_from(read_varint(bytes, &mut offset)?)
            .map_err(|_| ArchiveError::InvalidDirectory)?;
    }
    for entry in &mut entries {
        entry.length = u32::try_from(read_varint(bytes, &mut offset)?)
            .map_err(|_| ArchiveError::InvalidDirectory)?;
    }
    for index in 0..entries.len() {
        let stored = read_varint(bytes, &mut offset)?;
        entries[index].offset = if stored == 0 && index > 0 {
            entries[index - 1]
                .offset
                .checked_add(u64::from(entries[index - 1].length))
                .ok_or(ArchiveError::InvalidDirectory)?
        } else {
            stored
                .checked_sub(1)
                .ok_or(ArchiveError::InvalidDirectory)?
        };
    }
    Ok(entries)
}

fn read_varint(bytes: &[u8], offset: &mut usize) -> Result<u64, ArchiveError> {
    let mut result = 0_u64;
    for shift in (0..64).step_by(7) {
        let byte = *bytes.get(*offset).ok_or(ArchiveError::InvalidDirectory)?;
        *offset += 1;
        if shift == 63 && byte & 0x7e != 0 {
            return Err(ArchiveError::InvalidDirectory);
        }
        result |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Ok(result);
        }
    }
    Err(ArchiveError::InvalidDirectory)
}

fn locate(entries: &[DirectoryEntry], id: u64) -> Option<&DirectoryEntry> {
    let index = entries.partition_point(|entry| entry.id <= id);
    entries.get(index.checked_sub(1)?)
}

fn zxy_to_id(z: u8, x: u32, y: u32) -> Option<u64> {
    if z > 31 || (z == 0 && (x != 0 || y != 0)) {
        return None;
    }
    if z > 0 {
        let dimension = 1_u32 << z;
        if x >= dimension || y >= dimension {
            return None;
        }
    }
    if z == 0 {
        return Some(0);
    }
    let mut result = ((1_u64 << (2 * u32::from(z))) - 1) / 3;
    let (mut x, mut y) = (x, y);
    let mut scale = 1_u32 << (z - 1);
    while scale > 0 {
        let rx = u32::from(x & scale != 0);
        let ry = u32::from(y & scale != 0);
        result += u64::from((3 * rx) ^ ry) * u64::from(scale) * u64::from(scale);
        if ry == 0 {
            if rx != 0 {
                x = scale.wrapping_sub(1).wrapping_sub(x);
                y = scale.wrapping_sub(1).wrapping_sub(y);
            }
            std::mem::swap(&mut x, &mut y);
        }
        scale >>= 1;
    }
    Some(result)
}

// A small C boundary used by the Nitro package. It accepts file paths rather
// than a directory so its input surface matches the bundled Expo assets.
static FFI_SERVER: std::sync::Mutex<Option<LocalTileServer>> = std::sync::Mutex::new(None);

thread_local! {
    static FFI_LAST_ERROR: RefCell<CString> = RefCell::new(CString::default());
}

fn set_ffi_error(message: impl AsRef<str>) {
    let sanitized = message.as_ref().replace('\0', "?");
    FFI_LAST_ERROR.with(|slot| {
        *slot.borrow_mut() = CString::new(sanitized).expect("NUL bytes are removed");
    });
}

#[no_mangle]
/// Returns a thread-local diagnostic for the most recent FFI start failure.
/// The pointer is valid until the next tile-server FFI call on this thread.
pub extern "C" fn offline_tiles_last_error() -> *const std::os::raw::c_char {
    FFI_LAST_ERROR.with(|slot| slot.borrow().as_ptr())
}

#[no_mangle]
/// Starts the loopback-only PMTiles range server used by the mobile bridge.
///
/// # Safety
///
/// `root` must be either null or a valid NUL-terminated UTF-8 string that
/// remains readable for the duration of this call. The function never stores
/// the pointer beyond the call boundary.
pub unsafe extern "C" fn offline_tiles_start(root: *const std::os::raw::c_char, port: u16) -> u16 {
    if root.is_null() {
        set_ffi_error("tile_server_root_null");
        return 0;
    }
    // SAFETY: caller promises a NUL-terminated UTF-8 path for this call.
    let Ok(root) = unsafe { CStr::from_ptr(root) }.to_str() else {
        set_ffi_error("tile_server_root_invalid_utf8");
        return 0;
    };
    let config = match TileServerConfig::new(root, port) {
        Ok(config) => config,
        Err(error) => {
            set_ffi_error(error.to_string());
            return 0;
        }
    };
    let server = match serve_once(config) {
        Ok(server) => server,
        Err(error) => {
            set_ffi_error(error.to_string());
            return 0;
        }
    };
    let bound_port = server.address().port();
    let Ok(mut guard) = FFI_SERVER.lock() else {
        set_ffi_error("tile_server_state_lock_failed");
        return 0;
    };
    if guard.is_some() {
        set_ffi_error("tile_server_already_started");
        return 0;
    }
    *guard = Some(server);
    set_ffi_error("");
    bound_port
}

#[no_mangle]
pub extern "C" fn offline_tiles_stop() {
    if let Ok(mut guard) = FFI_SERVER.lock() {
        guard.take();
    }
}

#[must_use]
pub fn c_string(path: &Path) -> Option<CString> {
    CString::new(path.as_os_str().as_encoded_bytes()).ok()
}
