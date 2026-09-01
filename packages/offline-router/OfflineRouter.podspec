load 'nitrogen/generated/ios/OfflineRouter+autolinking.rb'

Pod::Spec.new do |spec|
  spec.name = 'OfflineRouter'
  spec.version = '0.1.0'
  spec.summary = 'Public offline PMTiles and CCH routing Nitro bridge'
  spec.license = { :type => 'MIT OR Apache-2.0' }
  spec.authors = { 'Offline Routing Demo contributors' => 'noreply@example.invalid' }
  spec.platforms = { :ios => '16.4' }
  spec.source = {
    :git => 'https://github.com/kernmod/offline-routing-demo.git',
    :tag => "v#{spec.version}"
  }
  spec.source_files = ['cpp/**/*.{hpp,cpp}']
  spec.vendored_frameworks = 'ios/OfflineRouterCore.xcframework'
  spec.preserve_paths = 'ios/OfflineRouterCore.xcframework'
  spec.dependency 'React-Core'
  spec.pod_target_xcconfig = {
    'OTHER_CPLUSPLUSFLAGS' => '$(inherited) -x objective-c++',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20'
  }

  framework_path = File.join(__dir__, 'ios', 'OfflineRouterCore.xcframework')
  unless File.directory?(framework_path)
    raise Pod::Informative,
          'OfflineRouterCore.xcframework is missing. Run scripts/build-ios-rust-xcframework.sh before pod install.'
  end

  spec.script_phase = {
    :name => 'Check OfflineRouterCore.xcframework',
    :execution_position => :before_compile,
    :script => <<-'SCRIPT'
      set -eu
      FRAMEWORK="$PODS_TARGET_SRCROOT/ios/OfflineRouterCore.xcframework"
      test -d "$FRAMEWORK" || {
        echo "error: OfflineRouterCore.xcframework is required; run the public iOS Rust builder first." >&2
        exit 1
      }
    SCRIPT
  }

  add_nitrogen_files(spec)
  install_modules_dependencies(spec)
end
