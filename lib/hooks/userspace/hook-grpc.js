/**
 * Copyright 2016 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

var cls = require('../../cls.js');
var shimmer = require('shimmer');
var semver = require('semver');
var SpanData = require('../../span-data.js');
var findIndex = require('lodash.findindex');

var agent;

var SUPPORTED_VERSIONS = '0.13 - 0.15';

function makeClientMethod(method, name) {
  return function clientMethodTrace() {
    var root = cls.getRootContext();
    if (!root) {
      agent.logger.debug('Untraced gRPC call: ', name);
      return method.apply(this, arguments);
    } else if (root === SpanData.nullSpan) {
      return method.apply(this, arguments);
    }
    var span = agent.startSpan('grpc-call-' + name);
    // Check if the response is through a stream or a callback.
    if (!method.responseStream) {
      // We need to wrap the callback with the context, to propagate it.
      // The callback is always required. It should be the only function in the
      // arguments, since we cannot send a function as an argument through gRPC.
      var cbIndex = findIndex(arguments, function(arg) {
        return typeof arg === 'function';
      });
      if (cbIndex !== -1) {
        arguments[cbIndex] = wrapCallback(span, arguments[cbIndex]);
      }
    }
    var call = method.apply(this, arguments);
    // The user might need the current context in listeners to this stream.
    cls.getNamespace().bindEmitter(call);
    if (method.responseStream) {
      call.on('end', function() {
        agent.endSpan(span);
      });
    }
    return call;
  };
}

/**
 * Wraps a callback so that the current span for this trace is also ended when
 * the callback is invoked.
 * @param {SpanData} span - The span that should end after this callback.
 * @param {function(?Error, value=)} done - The callback to be wrapped.
 */
function wrapCallback(span, done) {
  var fn = function(err, res) {
    agent.endSpan(span);
    done(err, res);
  };
  return cls.getNamespace().bind(fn);
}

function makeClientConstructorWrap(makeClientConstructor) {
  return function makeClientConstructorTrace(methods) {
    var Client = makeClientConstructor.apply(this, arguments);
    shimmer.massWrap(Client.prototype, Object.keys(methods), makeClientMethod);
    return Client;
  };
}

module.exports = function(version_, agent_) {
  if (!semver.satisfies(version_, SUPPORTED_VERSIONS)) {
    agent_.logger.info('grpc: unsupported version ' + version_ + ' loaded');
    return {};
  }
  return {
    'src/node/src/client.js': {
      patch: function(client) {
        agent = agent_;
        shimmer.wrap(client, 'makeClientConstructor',
            makeClientConstructorWrap);
      },
      unpatch: function(client) {
        // Only the Client constructor is unwrapped, so that future grpc.load's
        // will not wrap Client methods with tracing. However, existing Client
        // objects with wrapped prototype methods will continue tracing.
        shimmer.unwrap(client, 'makeClientConstructor');
        agent_.logger.info('gRPC makeClientConstructor: unpatched');
      }
    }
  };
};