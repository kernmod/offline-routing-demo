import assert from "node:assert/strict";
import test from "node:test";

import { extractOutputDirectories } from "../../scripts/device/prepare-cxx-dirs.mjs";

test("extractOutputDirectories collects both object and depfile parent directories", () => {
  const compileCommands = JSON.stringify([
    {
      directory: "/tmp/cmake/x86_64",
      command: "clang++ -o 'rnsvg_autolinked_build/CMakeFiles/react_codegen_rnsvg.dir/root/demo/react-native-svg/States.cpp.o' -MF rnsvg_autolinked_build/CMakeFiles/react_codegen_rnsvg.dir/root/demo/react-native-svg/States.cpp.o.d -c /tmp/States.cpp"
    },
    {
      directory: "/tmp/cmake/x86_64",
      command: "clang++ -o CMakeFiles/appmodules.dir/root/demo/autolinking.cpp.o -MF CMakeFiles/appmodules.dir/root/demo/autolinking.cpp.o.d -c /tmp/autolinking.cpp"
    }
  ]);

  assert.deepEqual(extractOutputDirectories(compileCommands), [
    "/tmp/cmake/x86_64/CMakeFiles/appmodules.dir/root/demo",
    "/tmp/cmake/x86_64/rnsvg_autolinked_build/CMakeFiles/react_codegen_rnsvg.dir/root/demo/react-native-svg"
  ]);
});
