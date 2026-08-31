Pod::Spec.new do |spec|
  spec.name = 'OfflineRouter'
  spec.version = '0.1.0'
  spec.summary = 'Offline PMTiles and CCH routing Nitro bridge'
  spec.license = { :type => 'MIT OR Apache-2.0' }
  spec.authors = { 'Demo' => 'noreply@example.invalid' }
  spec.platforms = { :ios => '15.1' }
  spec.source = { :git => 'https://example.invalid/offline-routing-demo.git', :tag => spec.version.to_s }
  spec.source_files = 'cpp/**/*.{hpp,cpp}', 'nitrogen/generated/**/*.{hpp,cpp}'
  spec.dependency 'React-Core'
  spec.dependency 'NitroModules'
  install_modules_dependencies(spec)
end
