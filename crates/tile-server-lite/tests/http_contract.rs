use std::fs;
use std::io::Write;
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::time::Duration;

use flate2::write::GzEncoder;
use flate2::Compression;
use tile_server_lite::{
    c_string, offline_tiles_last_error, offline_tiles_start, offline_tiles_stop, serve_once,
    ArchiveError, TileServerConfig, TileServerError,
};

const OVERSIZED_DIRECTORY_BYTES: usize = 1024 * 1024 + 1;

fn fixture_dir() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("temporary fixture directory");
    fs::write(dir.path().join("map.pmtiles"), minimal_pmtiles()).expect("write pmtiles");
    fs::write(dir.path().join("style.json"), b"{\"version\":8}").expect("write style");
    dir
}

fn minimal_pmtiles() -> Vec<u8> {
    let mut bytes = vec![0_u8; 127];
    bytes[..7].copy_from_slice(b"PMTiles");
    bytes[7] = 3;
    bytes[8..16].copy_from_slice(&127_u64.to_le_bytes());
    bytes[16..24].copy_from_slice(&1_u64.to_le_bytes());
    bytes[56..64].copy_from_slice(&128_u64.to_le_bytes());
    bytes[97] = 1;
    bytes[98] = 1;
    bytes.extend_from_slice(&[
        0, b'a', b'b', b'c', b'd', b'e', b'f', b'g', b'h', b'i', b'j',
    ]);
    bytes
}

fn pmtiles_with_leaf(tile: &[u8], internal_compression: u8, tile_compression: u8) -> Vec<u8> {
    pmtiles_with_leaf_depth(tile, internal_compression, tile_compression, 1)
}

fn pmtiles_with_leaf_depth(
    tile: &[u8],
    internal_compression: u8,
    tile_compression: u8,
    leaf_depth: usize,
) -> Vec<u8> {
    assert!(leaf_depth > 0);
    let mut leaf_parts = vec![compress_directory(
        &directory(&[(0, 1, tile.len() as u32, 0)]),
        internal_compression,
    )];
    let mut current_offset = 0_u64;
    for _ in 1..leaf_depth {
        let current_length = leaf_parts.last().expect("leaf directory").len() as u32;
        current_offset = leaf_parts.iter().map(Vec::len).sum::<usize>() as u64;
        leaf_parts.push(compress_directory(
            &directory(&[(0, 0, current_length, current_offset - current_length as u64)]),
            internal_compression,
        ));
    }
    let leaf = leaf_parts.concat();
    let outer_length = leaf_parts.last().expect("outer leaf directory").len() as u32;
    let root = compress_directory(
        &directory(&[(0, 0, outer_length, current_offset)]),
        internal_compression,
    );
    pmtiles_from_sections(&root, &leaf, tile, internal_compression, tile_compression)
}

fn pmtiles_from_sections(
    root: &[u8],
    leaf: &[u8],
    tile: &[u8],
    internal_compression: u8,
    tile_compression: u8,
) -> Vec<u8> {
    let root_offset = 127_u64;
    let leaf_offset = root_offset + root.len() as u64;
    let tile_offset = leaf_offset + leaf.len() as u64;
    let mut bytes = vec![0_u8; 127];
    bytes[..7].copy_from_slice(b"PMTiles");
    bytes[7] = 3;
    write_header_number(&mut bytes, 8, root_offset);
    write_header_number(&mut bytes, 16, root.len() as u64);
    write_header_number(&mut bytes, 40, leaf_offset);
    write_header_number(&mut bytes, 48, leaf.len() as u64);
    write_header_number(&mut bytes, 56, tile_offset);
    write_header_number(&mut bytes, 64, tile.len() as u64);
    bytes[97] = internal_compression;
    bytes[98] = tile_compression;
    bytes[99] = 1;
    bytes.extend_from_slice(root);
    bytes.extend_from_slice(leaf);
    bytes.extend_from_slice(tile);
    bytes
}

fn directory(entries: &[(u64, u32, u32, u64)]) -> Vec<u8> {
    let mut bytes = Vec::new();
    write_varint(&mut bytes, entries.len() as u64);
    let mut previous_id = 0;
    for &(id, _, _, _) in entries {
        write_varint(&mut bytes, id - previous_id);
        previous_id = id;
    }
    for &(_, run, _, _) in entries {
        write_varint(&mut bytes, u64::from(run));
    }
    for &(_, _, length, _) in entries {
        write_varint(&mut bytes, u64::from(length));
    }
    for &(_, _, _, offset) in entries {
        write_varint(&mut bytes, offset + 1);
    }
    bytes
}

fn write_varint(bytes: &mut Vec<u8>, mut value: u64) {
    while value >= 0x80 {
        bytes.push((value as u8 & 0x7f) | 0x80);
        value >>= 7;
    }
    bytes.push(value as u8);
}

fn write_header_number(bytes: &mut [u8], offset: usize, value: u64) {
    bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}

fn compress_directory(bytes: &[u8], compression: u8) -> Vec<u8> {
    match compression {
        1 => bytes.to_vec(),
        2 => gzip(bytes),
        _ => panic!("test fixture only supports none and gzip directory compression"),
    }
}

fn gzip(bytes: &[u8]) -> Vec<u8> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(bytes).expect("gzip fixture bytes");
    encoder.finish().expect("finish gzip fixture")
}

fn fixture_with_archive(archive: &[u8]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("temporary fixture directory");
    fs::write(dir.path().join("map.pmtiles"), archive).expect("write pmtiles");
    fs::write(dir.path().join("style.json"), b"{\"version\":8}").expect("write style");
    dir
}

#[test]
fn config_is_loopback_only_and_rejects_missing_assets() {
    let fixture = fixture_dir();
    let config = TileServerConfig::new(fixture.path(), 0).expect("valid loopback config");
    assert_eq!(config.bind_ip(), Ipv4Addr::LOCALHOST);
    assert!(matches!(
        TileServerConfig::with_bind(fixture.path(), Ipv4Addr::UNSPECIFIED, 0),
        Err(TileServerError::NonLoopbackBind(_))
    ));
    fs::remove_file(fixture.path().join("style.json")).expect("remove style");
    assert!(matches!(
        TileServerConfig::new(fixture.path(), 0),
        Err(TileServerError::MissingAsset(_))
    ));
}

#[test]
fn health_style_and_byte_ranges_are_served_without_network_fallback() {
    let fixture = fixture_dir();
    let server =
        serve_once(TileServerConfig::new(fixture.path(), 0).expect("config")).expect("server");
    let address = server.address();
    assert_eq!(address.ip(), std::net::IpAddr::V4(Ipv4Addr::LOCALHOST));
    let health = raw_request(address, "GET /health HTTP/1.0\r\n\r\n");
    assert!(health.starts_with("HTTP/1.0 200"));
    assert!(health.ends_with("ok"));
    let style = raw_request(address, "GET /style.json HTTP/1.0\r\n\r\n");
    assert!(style.starts_with("HTTP/1.0 200"));
    assert!(style.contains("application/json"));
    let tile = raw_request(
        address,
        "GET /map.pmtiles HTTP/1.0\r\nRange: bytes=130-133\r\n\r\n",
    );
    assert!(tile.starts_with("HTTP/1.0 206"));
    assert!(tile.contains("Content-Range: bytes 130-133/138"));
    assert!(tile.ends_with("cdef"));
}

#[test]
fn rejects_traversal_unsupported_methods_and_invalid_ranges() {
    let fixture = fixture_dir();
    let server =
        serve_once(TileServerConfig::new(fixture.path(), 0).expect("config")).expect("server");
    let address = server.address();
    assert!(raw_request(address, "GET /../Cargo.toml HTTP/1.0\r\n\r\n").starts_with("HTTP/1.0 404"));
    assert!(raw_request(address, "POST /map.pmtiles HTTP/1.0\r\n\r\n").starts_with("HTTP/1.0 405"));
    assert!(raw_request(
        address,
        "GET /map.pmtiles HTTP/1.0\r\nRange: bytes=200-202\r\n\r\n"
    )
    .starts_with("HTTP/1.0 416"));
}

#[test]
fn public_sydney_fixture_serves_a_vector_tile_from_its_pmtiles_archive() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/sydney");
    let server = serve_once(TileServerConfig::new(root, 0).expect("public fixture config"))
        .expect("public fixture server");
    let response = raw_request_bytes(
        server.address(),
        "GET /tiles/14/15073/9831.pbf HTTP/1.0\r\n\r\n",
    );
    assert!(
        response.starts_with(b"HTTP/1.0 200"),
        "expected bundled Sydney tile"
    );
    let headers = String::from_utf8_lossy(
        &response[..response
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .expect("header terminator")],
    );
    assert!(headers.contains("application/x-protobuf"));
}

#[test]
fn follows_a_gzip_compressed_leaf_directory_entry_to_serve_its_tile() {
    let tile = b"vector-tile-from-leaf";
    let fixture = fixture_with_archive(&pmtiles_with_leaf(tile, 2, 1));
    let server =
        serve_once(TileServerConfig::new(fixture.path(), 0).expect("config")).expect("server");

    let response = raw_request_bytes(server.address(), "GET /tiles/0/0/0.pbf HTTP/1.0\r\n\r\n");
    let (headers, body) = split_response(&response);

    assert!(headers.starts_with("HTTP/1.0 200"), "{headers}");
    assert_eq!(body, tile);
}

#[test]
fn rejects_a_gzip_root_directory_that_expands_past_the_safe_limit() {
    let inflated = vec![0_u8; OVERSIZED_DIRECTORY_BYTES];
    let root = gzip(&inflated);
    let fixture = fixture_with_archive(&pmtiles_from_sections(&root, &[], &[], 2, 1));

    let result = serve_once(TileServerConfig::new(fixture.path(), 0).expect("config"));

    assert!(matches!(result, Err(TileServerError::Archive(_))));
}

#[test]
fn rejects_a_gzip_leaf_directory_that_expands_past_the_safe_limit() {
    let leaf = gzip(&vec![0_u8; OVERSIZED_DIRECTORY_BYTES]);
    let root = gzip(&directory(&[(0, 0, leaf.len() as u32, 0)]));
    let fixture = fixture_with_archive(&pmtiles_from_sections(&root, &leaf, &[], 2, 1));
    let server =
        serve_once(TileServerConfig::new(fixture.path(), 0).expect("config")).expect("server");

    let response = raw_request(server.address(), "GET /tiles/0/0/0.pbf HTTP/1.0\r\n\r\n");

    assert!(response.starts_with("HTTP/1.0 500"), "{response}");
}

#[test]
fn follows_nested_leaf_directories_with_a_bounded_lookup() {
    let tile = b"vector-tile-from-nested-leaf";
    let fixture = fixture_with_archive(&pmtiles_with_leaf_depth(tile, 1, 1, 2));
    let server =
        serve_once(TileServerConfig::new(fixture.path(), 0).expect("config")).expect("server");

    let response = raw_request_bytes(server.address(), "GET /tiles/0/0/0.pbf HTTP/1.0\r\n\r\n");
    let (headers, body) = split_response(&response);

    assert!(headers.starts_with("HTTP/1.0 200"), "{headers}");
    assert_eq!(body, tile);
}

#[test]
fn rejects_a_directory_chain_beyond_the_lookup_depth_limit() {
    let fixture = fixture_with_archive(&pmtiles_with_leaf_depth(b"tile", 1, 1, 4));
    let server =
        serve_once(TileServerConfig::new(fixture.path(), 0).expect("config")).expect("server");

    let response = raw_request(server.address(), "GET /tiles/0/0/0.pbf HTTP/1.0\r\n\r\n");

    assert!(response.starts_with("HTTP/1.0 500"), "{response}");
}

#[test]
fn leaf_directory_reads_are_bounded_by_the_header_region() {
    let tile = b"tile-bytes";
    let mut archive = pmtiles_with_leaf(tile, 1, 1);
    let root_offset = u64::from_le_bytes(archive[8..16].try_into().expect("root offset")) as usize;
    let root_length = u64::from_le_bytes(archive[16..24].try_into().expect("root length")) as usize;
    let forged_root = directory(&[(0, 0, tile.len() as u32, tile.len() as u64)]);
    assert_eq!(forged_root.len(), root_length);
    archive[root_offset..root_offset + root_length].copy_from_slice(&forged_root);
    let fixture = fixture_with_archive(&archive);
    let server =
        serve_once(TileServerConfig::new(fixture.path(), 0).expect("config")).expect("server");

    let response = raw_request(server.address(), "GET /tiles/0/0/0.pbf HTTP/1.0\r\n\r\n");

    assert!(response.starts_with("HTTP/1.0 500"), "{response}");
}

#[test]
fn uncompressed_tiles_are_served_without_a_content_encoding() {
    let tile = b"plain-vector-tile";
    let fixture = fixture_with_archive(&pmtiles_with_leaf(tile, 1, 1));
    let server =
        serve_once(TileServerConfig::new(fixture.path(), 0).expect("config")).expect("server");

    let response = raw_request_bytes(server.address(), "GET /tiles/0/0/0.pbf HTTP/1.0\r\n\r\n");
    let (headers, body) = split_response(&response);

    assert!(headers.starts_with("HTTP/1.0 200"), "{headers}");
    assert!(!headers.to_ascii_lowercase().contains("content-encoding"));
    assert_eq!(body, tile);
}

#[test]
fn gzip_tiles_keep_their_bytes_and_declare_the_content_encoding() {
    let compressed_tile = gzip(b"gzip-vector-tile");
    let fixture = fixture_with_archive(&pmtiles_with_leaf(&compressed_tile, 1, 2));
    let server =
        serve_once(TileServerConfig::new(fixture.path(), 0).expect("config")).expect("server");

    let response = raw_request_bytes(server.address(), "GET /tiles/0/0/0.pbf HTTP/1.0\r\n\r\n");
    let (headers, body) = split_response(&response);

    assert!(headers.starts_with("HTTP/1.0 200"), "{headers}");
    assert!(headers.contains("Content-Encoding: gzip"), "{headers}");
    assert_eq!(body, compressed_tile);
}

#[test]
fn unsupported_tile_compression_is_rejected_when_opening_the_archive() {
    let fixture = fixture_with_archive(&pmtiles_with_leaf(b"tile", 1, 3));

    let result = serve_once(TileServerConfig::new(fixture.path(), 0).expect("config"));

    assert!(matches!(
        result,
        Err(TileServerError::Archive(
            ArchiveError::UnsupportedCompression
        ))
    ));
}

#[test]
fn ffi_lifecycle_is_local_and_c_string_rejects_embedded_nul() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/sydney");
    assert!(c_string(&root).is_some());
    assert_eq!(unsafe { offline_tiles_start(std::ptr::null(), 0) }, 0);
    let error = unsafe { std::ffi::CStr::from_ptr(offline_tiles_last_error()) }
        .to_str()
        .expect("ffi error is utf-8");
    assert_eq!(error, "tile_server_root_null");
    let root_c = c_string(&root).expect("fixture C path");
    let port = unsafe { offline_tiles_start(root_c.as_ptr(), 0) };
    assert_ne!(port, 0);
    offline_tiles_stop();
    offline_tiles_stop();

    let fixture = fixture_dir();
    let server =
        serve_once(TileServerConfig::new(fixture.path(), 0).expect("config")).expect("server");
    server.stop();
}

fn raw_request(address: SocketAddr, request: &str) -> String {
    String::from_utf8_lossy(&raw_request_bytes(address, request)).into_owned()
}

fn raw_request_bytes(address: SocketAddr, request: &str) -> Vec<u8> {
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(2)).expect("connect");
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .expect("read timeout");
    use std::io::{Read, Write};
    stream.write_all(request.as_bytes()).expect("write request");
    let mut response = Vec::new();
    stream.read_to_end(&mut response).expect("read response");
    response
}

fn split_response(response: &[u8]) -> (String, &[u8]) {
    let boundary = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .expect("header terminator");
    (
        String::from_utf8_lossy(&response[..boundary]).into_owned(),
        &response[boundary + 4..],
    )
}
