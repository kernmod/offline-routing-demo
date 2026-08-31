module.exports = {
  dependency: {
    platforms: {
      ios: {},
      android: {
        sourceDir: "./android",
        packageImportPath: "import com.offlinerouter.OfflineRouterPackage;",
        packageInstance: "new OfflineRouterPackage()"
      }
    }
  }
};
