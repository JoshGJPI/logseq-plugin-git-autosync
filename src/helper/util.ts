import {
  ACTIVE_STYLE,
  HIDE_POPUP_STYLE,
  INACTIVE_STYLE,
  SHOW_POPUP_STYLE,
} from "./constants";
import { status, inProgress, execGitCommand, pull, push, commit } from "./git";
import type { IGitResult } from "@logseq/libs/dist/LSPlugin.user"

//checks if there are changes in local files
export const checkStatus = async () => {
  console.log("Checking status...");
  const statusRes = await status(false);
  if (statusRes?.stdout === "") {
    console.log("No changes", statusRes);
    setPluginStyle(INACTIVE_STYLE);
  } else {
    console.log("Need save", statusRes);
    setPluginStyle(ACTIVE_STYLE);
  }
  return statusRes;
};

let pluginStyle = "";
export const setPluginStyle = (style: string) => {
  pluginStyle = style;
  logseq.provideStyle({ key: "git", style });
};
export const getPluginStyle = () => pluginStyle;

export const showPopup = () => {
  const _style = getPluginStyle();
  //updated element id based on alternate plugin name
  logseq.App.queryElementRect("#logseq-git-autosync--git").then((triggerIconRect) => {
    // console.log("[faiz:] === triggerIconRect", triggerIconRect);
    if (!triggerIconRect) return;
    const popupWidth = 120 + 10 * 2;
    const left =
      triggerIconRect.left + triggerIconRect.width / 2 - popupWidth / 2;
    const top = triggerIconRect.top + triggerIconRect.height;
    const _style = getPluginStyle();
    setPluginStyle(
      `${_style}\n.plugin-git-popup{left:${left}px;top:${top}px;}`
    );
  });
  setPluginStyle(`${_style}\n${SHOW_POPUP_STYLE}`);
};
export const hidePopup = () => {
  const _style = getPluginStyle();
  setPluginStyle(`${_style}\n${HIDE_POPUP_STYLE}`);
};

export const debounce = (fn, wait: number = 100, environment?: any) => {
  let timer = null;
  return function () {
    // @ts-ignore
    const context = environment || this;
    const args = arguments;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    // @ts-ignore
    timer = setTimeout(function () {
      fn.apply(context, args);
    }, wait);
  };
};

export const checkStatusWithDebounce = debounce(() => {
  checkStatus();
}, 2000);

//checks to see if last commit in remote files matches last commit of local files
export const isRepoUpTodate = async () => {
  await execGitCommand(["fetch"]);
  const local = await execGitCommand(["rev-parse", "HEAD"]);
  const remote = await execGitCommand(["rev-parse", "@{u}"]);
  // logseq.UI.showMsg(`${local.stdout} === ${remote.stdout}`, "success", { timeout: 30 });
  return local.stdout === remote.stdout;
};

//checks to see if local files are synced with remote files
//This is the function I want to automate
export const checkIsSynced = async (showMsg = true) => {
  if (inProgress()) {
    console.log("[faiz:] === checkIsSynced Git in progress, skip check");
    return
  }

  const isSynced = await isRepoUpTodate();
  if (!isSynced)
    if(showMsg) {
      logseq.UI.showMsg(
      `The current repository is not synchronized with the remote repository, please check.`,
      "warning",
      { timeout: 0 }
      );
    }
  return isSynced;
};

export const syncFiles = async (triggerSource: string) => {
  console.log(`[syncFiles:] === ${triggerSource} Start`);

  //check if a Git command is alread in progress
  if (inProgress()) {
    console.log("[syncFiles:] === Git in progress, skip check");
    return;
  }

  //default notification message
  let message: string = 'You\'re Synced with Remote';

  //Set up Git command result containers
  let pullResults: IGitResult;
  let commitResults: IGitResult;
  let pushResults: IGitResult;
  let gitError = false;

  //check to see if there are local changes
  const localStatus = await checkStatus();
  const isLocalCurrent = localStatus.stdout === "" ? true : false;
  
  //check to see if the remote branch has been changed
  const remoteStatus = await checkIsSynced(false);
  if (remoteStatus === undefined) {
    //if check is in progress or error checking remote, stop syncFiles()
    logseq.UI.showMsg("Unable to check Remote files\nPlease wait and try again", "warning", { timeout: 3000 });
    return;
  }
  const isRemoteCurrent = remoteStatus;

  //if local or remote has been changed, update files
  if (!isLocalCurrent || !isRemoteCurrent) {
    hidePopup();
    logseq.UI.showMsg("Syncing files with Remote...", "", { timeout: 5000 });

    //if only remote has been changed => pull only
    if (!isRemoteCurrent && isLocalCurrent) {
      pullResults = await pull(false);

      //check if there's an error with pull command
      if (pullResults.exitCode === 0) {
        message = 'Remote changes pulled to Local';

      } else {
        gitError = true;
        console.log("[syncFiles:] pull Error:", pullResults);
      }
    }

    //if only local has been changed => commit and push only
    if (isRemoteCurrent && !isLocalCurrent) {
      commitResults = await commit(false, `[logseq-plugin-git-autosync:commit] ${new Date().toISOString()}`);
      pushResults = await push(false);

      //check if there's an error with commit or push commands
      if ( commitResults.exitCode === 0 && pushResults.exitCode === 0) {
        message = 'Local changes pushed to Remote'

      } else {
        gitError = true;
        console.log("[syncFiles:] commit results:", commitResults);
        console.log("[syncFiles:] push results:", pushResults);
      }
    }

    //if both local and remote have changed => pull, commit, then push
    if (!isLocalCurrent && !isRemoteCurrent) {
      commitResults = await commit(
        false,
        `[logseq-plugin-git-autosync:commit] ${new Date().toISOString()}`
        );
      pullResults = await pull(false);

      //Check if there are errors with pull, commit, or push commands
      if (pullResults.exitCode === 0 && commitResults.exitCode === 0) {
        pushResults = await push(false);

        if (pushResults.exitCode === 0) {
          message = 'Remote changes pulled to Local, then Local changes pushed to Remote';

        } else {
          gitError = true;
          console.log("[syncFiles:] push results:", pushResults);
        }
      } else {
        gitError = true;
        console.log("[syncFiles:] push results:", pullResults);
        console.log("[syncFiles:] commit results:", commitResults);
      }
    }

    //If git error, update message
    if (gitError) {
      message = "Error syncing files"
    }

  }
  //Display results of sync
  let messageType = gitError ? "warning" : "success";
  logseq.UI.showMsg(message, messageType, { timeout: 8000 });
  checkStatus();
}

//Wait 1 minute before autosyncing again
export const syncFilesWithDebounce = debounce(() => {
  syncFiles("AUTO");
}, 60000);