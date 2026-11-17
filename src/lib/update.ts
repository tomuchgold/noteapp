/** 版本检查：读释放页最新 tag，判断是否有新版本 */

import { invoke } from "@tauri-apps/api/core";

export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";

export interface UpdateInfo {
  current: string;
  latest: string;
  newer: boolean;
  url: string;
  notes: string;
  published_at: string;
}

const UPDATE_API_KEY = "notepp.update-api";
const UPDATE_TOKEN_KEY = "notepp.update-token";

export function getUpdateApi(): string {
  return localStorage.getItem(UPDATE_API_KEY) ?? "";
}

export function setUpdateApi(url: string) {
  if (url.trim()) localStorage.setItem(UPDATE_API_KEY, url.trim());
  else localStorage.removeItem(UPDATE_API_KEY);
}

export function getUpdateToken(): string {
  return localStorage.getItem(UPDATE_TOKEN_KEY) ?? "";
}

export function setUpdateToken(token: string) {
  if (token.trim()) localStorage.setItem(UPDATE_TOKEN_KEY, token.trim());
  else localStorage.removeItem(UPDATE_TOKEN_KEY);
}

/** 检查更新；私有仓库需填 GitHub Token（只读 public_repo / releases 权限即可） */
export async function checkUpdate(): Promise<UpdateInfo> {
  return invoke<UpdateInfo>("check_update", {
    current: APP_VERSION,
    apiUrl: getUpdateApi() || null,
    token: getUpdateToken() || null,
  });
}
