'use strict';
/**
 * Termux shim for `node-addon-require-builtin`.
 *
 * Upstream ships a prebuilt Node-API addon whose binding serves Node's internal
 * builtins ("runtime probing for internal access"). Optional platform packages
 * exist only for darwin-x64/arm64, linux-{x64,arm64}-gnu, and win32; there is no
 * android/arm64 build, and Termux cannot load a glibc linux-arm64 binary.
 *
 * Contract preserved from the upstream package:
 *   - requireBuiltin(moduleId) -> the internal module
 *   - isAllowedInternalId(moduleId) -> boolean
 *   - getBindingInfo() -> frozen descriptor
 *
 * Resolution order:
 *   1. the real native path (native-custom-loader), so this shim is inert on
 *      hosts that do have a binding;
 *   2. Node's own `--expose-internals`, which exposes the same internal module
 *      objects to plain `require`. That flag is rejected in NODE_OPTIONS, which
 *      is why the launcher (lib/termux-bin.js) re-execs Node with it.
 */
const path = require('node:path');
const { createRequire } = require('node:module');

const req = createRequire(__filename);

const INTERNALS_FLAG = '--expose-internals';

let native = null;
let nativeError = null;
try {
  const { createEntryApi } = require('node-addon-native-custom-loader');
  native = createEntryApi(path.resolve(__dirname, '..'));
} catch (error) {
  nativeError = error;
}

function internalsAvailable() {
  return process.execArgv.includes(INTERNALS_FLAG);
}

function requireBuiltin(moduleId) {
  if (native !== null) return native.requireBuiltin(moduleId);
  if (!internalsAvailable()) {
    throw Object.assign(
      new Error(
        `node-addon-require-builtin (Termux shim): no native binding for ` +
        `${process.platform}-${process.arch}, and Node was not started with ${INTERNALS_FLAG}.`,
      ),
      { code: 'ERR_NARB_NO_BINDING', cause: nativeError },
    );
  }
  return req(moduleId);
}

function isAllowedInternalId(moduleId) {
  if (native !== null) return native.isAllowedInternalId(moduleId);
  if (typeof moduleId !== 'string' || !internalsAvailable()) return false;
  try {
    req(moduleId);
    return true;
  } catch {
    return false;
  }
}

let bindingInfo;
function getBindingInfo() {
  if (native !== null) return native.getBindingInfo();
  if (bindingInfo) return bindingInfo;
  bindingInfo = Object.freeze({
    mode: 'expose-internals',
    product: 'node-addon-require-builtin-termux-shim',
    backend: 'js',
    abi: `node-${process.versions.modules}`,
    bindingPath: __filename,
    bindingSource: 'termux-shim',
    localBindingPath: path.resolve(__dirname, '..', 'build'),
    optionalPackageName: `node-addon-require-builtin-${process.platform}-${process.arch}`,
    optionalBinaryRelativePath: 'bin/require_builtin.node',
    platformPackageSuffix: `${process.platform}-${process.arch}`,
    nativeError: nativeError === null ? null : String(nativeError && nativeError.message),
  });
  return bindingInfo;
}

exports.requireBuiltin = requireBuiltin;
exports.isAllowedInternalId = isAllowedInternalId;
exports.getBindingInfo = getBindingInfo;
exports.default = { requireBuiltin, isAllowedInternalId, getBindingInfo };
