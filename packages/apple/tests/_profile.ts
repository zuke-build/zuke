// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT
// cspell:ignore AAEC

/**
 * Builds fake `.mobileprovision` bytes for tests: a property list between
 * binary bytes standing in for the CMS envelope, the way a real profile
 * stores it. Also an in-memory `ProvisioningHost`.
 *
 * @module
 */

import type { ProvisioningHost } from "../src/provisioning_host.ts";

/** What a fake profile holds; every field has a default. */
export interface FakeProfile {
  uuid?: string;
  name?: string;
  expires?: string;
  devices?: boolean;
  allDevices?: boolean;
  getTaskAllow?: boolean;
  appId?: string;
  xcodeManaged?: boolean;
  /** Replaces the whole plist body when set. */
  plist?: string;
}

/** The XML plist of a fake profile. */
export function profilePlist(p: FakeProfile = {}): string {
  return p.plist ?? `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>AppIDName</key>
  <string>Example &amp; Co</string>
  <key>CreationDate</key>
  <date>2026-01-01T00:00:00Z</date>
  <key>Platform</key>
  <array><string>iOS</string></array>
  <key>DeveloperCertificates</key>
  <array><data>
    AAEC
  </data></array>
  <key>Entitlements</key>
  <dict>
    <key>application-identifier</key>
    <string>${p.appId ?? "ABCDE12345.com.example.app"}</string>
    <key>get-task-allow</key>
    <${p.getTaskAllow === true}/>
  </dict>
  <key>ExpirationDate</key>
  <date>${p.expires ?? "2027-01-01T00:00:00Z"}</date>
  <key>IsXcodeManaged</key>
  <${p.xcodeManaged === true} />
  <key>Name</key>
  <string>${p.name ?? "Example App Store"}</string>
  ${
    p.devices === true
      ? "<key>ProvisionedDevices</key><array><string>00008030</string></array>"
      : ""
  }
  ${p.allDevices === true ? "<key>ProvisionsAllDevices</key><true/>" : ""}
  <key>TeamIdentifier</key>
  <array><string>ABCDE12345</string></array>
  <key>TeamName</key>
  <string>Example Ltd</string>
  <key>TimeToLive</key>
  <integer>365</integer>
  <key>UUID</key>
  <string>${p.uuid ?? "0f8fad5b-d9cb-469f-a165-70867728950e"}</string>
  <key>Version</key>
  <integer>1</integer>
</dict>
</plist>`;
}

/** Fake `.mobileprovision` bytes: binary, the plist, binary. */
export function profileBytes(p: FakeProfile = {}): Uint8Array {
  const xml = new TextEncoder().encode(profilePlist(p));
  const out = new Uint8Array(xml.length + 8);
  out.set([0x30, 0x80, 0x06, 0x09], 0);
  out.set(xml, 4);
  out.set([0xa0, 0x82, 0x00, 0x00], xml.length + 4);
  return out;
}

/** `bytes` as base64. */
export function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** An in-memory {@link ProvisioningHost}, with hooks to make steps fail. */
export class MemoryHost implements ProvisioningHost {
  readonly files = new Map<string, Uint8Array>();
  readonly directories: string[] = [];
  failWrite?: (path: string) => boolean;
  failRemove?: (path: string) => boolean;

  readFile(path: string): Promise<Uint8Array> {
    const data = this.files.get(path);
    return data === undefined
      ? Promise.reject(new Deno.errors.NotFound(path))
      : Promise.resolve(data);
  }
  makeDirectory(path: string): Promise<void> {
    this.directories.push(path);
    return Promise.resolve();
  }
  writeFile(path: string, data: Uint8Array): Promise<void> {
    if (this.failWrite?.(path) === true) {
      return Promise.reject(new Error("disk full"));
    }
    this.files.set(path, data);
    return Promise.resolve();
  }
  remove(path: string): Promise<void> {
    if (this.failRemove?.(path) === true) {
      return Promise.reject(new Error("busy"));
    }
    this.files.delete(path);
    return Promise.resolve();
  }
  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(path));
  }
  home(): string {
    return "/Users/ci";
  }
}
