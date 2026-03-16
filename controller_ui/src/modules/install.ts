import { installHeaderPopupsModule } from "./headerPopups";
import { installHeaderActionsModule } from "./headerActions";
import { installNavigationActionsModule } from "./navigationActions";
import { installTabsModule } from "./tabs";
import { installUrlEditModule } from "./urlEdit";
import { installLogPanelModule } from "./logPanel";
import { installDockLayoutModule } from "./dockLayout";
import { installFloatingDockModule } from "./floatingDock";
import { installVideoFitModule } from "./videoFit";

declare global {
  interface Window {
    __controllerReactModulesInstalled?: boolean;
  }
}

export function installControllerModules() {
  if (window.__controllerReactModulesInstalled) return;
  window.__controllerReactModulesInstalled = true;

  installHeaderPopupsModule();
  installHeaderActionsModule();
  installNavigationActionsModule();
  installTabsModule();
  installUrlEditModule();
  installLogPanelModule();
  installDockLayoutModule();
  installFloatingDockModule();
  installVideoFitModule();
}
