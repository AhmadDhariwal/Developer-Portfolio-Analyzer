"use strict";
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNormalizedArgs = exports.STABLE_IPC_TRANSPORT_VALUE = exports.OLD_IPC_TRANSPORT_VALUE = void 0;
const os_1 = require("os");
const semantic_conventions_1 = require("@opentelemetry/semantic-conventions");
const semconv_1 = require("./semconv");
// There is no `NET_TRANSPORT_VALUE_UNIX` because breaking change
// https://github.com/open-telemetry/opentelemetry-specification/pull/3426
// *removed* it. This was from before semconv got more careful of removals.
exports.OLD_IPC_TRANSPORT_VALUE = (0, os_1.platform)() === 'win32' ? semconv_1.NET_TRANSPORT_VALUE_PIPE : 'unix';
exports.STABLE_IPC_TRANSPORT_VALUE = (0, os_1.platform)() === 'win32'
    ? semantic_conventions_1.NETWORK_TRANSPORT_VALUE_PIPE
    : semantic_conventions_1.NETWORK_TRANSPORT_VALUE_UNIX;
function getHost(args) {
    return typeof args[1] === 'string' ? args[1] : 'localhost';
}
function getNormalizedArgs(args) {
    const opt = args[0];
    if (!opt) {
        return;
    }
    switch (typeof opt) {
        case 'number':
            return {
                port: opt,
                host: getHost(args),
            };
        case 'object':
            if (Array.isArray(opt)) {
                return getNormalizedArgs(opt);
            }
            return opt;
        case 'string': {
            const maybePort = Number(opt);
            if (maybePort >= 0) {
                return {
                    port: maybePort,
                    host: getHost(args),
                };
            }
            return {
                path: opt,
            };
        }
        default:
            return;
    }
}
exports.getNormalizedArgs = getNormalizedArgs;
//# sourceMappingURL=utils.js.map