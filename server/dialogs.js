// Native Windows dialogs (folder picker, open-project picker) and "show in Explorer".
// The browser can't hand us real file paths, so the server pops the system dialog
// itself through PowerShell + WinForms and returns what the user chose.
import { spawn } from "node:child_process";
import { httpError } from "./projects.js";

const isWin = process.platform === "win32";

// single-quoted PowerShell literal
const psStr = (s) => "'" + String(s || "").replace(/'/g, "''") + "'";

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    // -EncodedCommand sidesteps every quoting problem with Chinese paths
    const prelude = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n"
      + "Add-Type -AssemblyName System.Windows.Forms\n"
      + "[System.Windows.Forms.Application]::EnableVisualStyles()\n"
      // an invisible top-most owner keeps the dialog in front of the browser
      + "$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }\n";
    const encoded = Buffer.from(prelude + script, "utf16le").toString("base64");
    const ps = spawn("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { windowsHide: true });
    let out = "", err = "";
    ps.stdout.on("data", (d) => { out += d.toString("utf8"); });
    ps.stderr.on("data", (d) => { err += d.toString("utf8"); });
    ps.on("error", reject);
    ps.on("close", (code) => {
      if (code !== 0) reject(new Error(err.trim() || "PowerShell 退出码 " + code));
      else resolve(out.replace(/^﻿/, "").trim());
    });
  });
}

export async function pickFolder(title, start) {
  if (!isWin) throw httpError(501, "系统文件夹对话框目前只支持 Windows，请直接输入路径");
  const path = await runPowerShell(
    "$d = New-Object System.Windows.Forms.FolderBrowserDialog\n"
    + "$d.Description = " + psStr(title || "选择文件夹") + "\n"
    + "$d.ShowNewFolderButton = $true\n"
    + (start ? "$d.SelectedPath = " + psStr(start) + "\n" : "")
    + "if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }\n",
  );
  return path || null;
}

export async function pickProjectFile(start) {
  if (!isWin) throw httpError(501, "系统文件对话框目前只支持 Windows，请直接输入路径");
  const path = await runPowerShell(
    "$d = New-Object System.Windows.Forms.OpenFileDialog\n"
    + "$d.Title = '打开光台项目'\n"
    + "$d.Filter = '光台项目 (*.gtproj)|*.gtproj'\n"
    + (start ? "$d.InitialDirectory = " + psStr(start) + "\n" : "")
    + "if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.FileName }\n",
  );
  return path || null;
}

export function reveal(file) {
  if (isWin) spawn("explorer.exe", ["/select,", file], { detached: true, stdio: "ignore" }).unref();
  else spawn(process.platform === "darwin" ? "open" : "xdg-open", [file], { detached: true, stdio: "ignore" }).unref();
}
