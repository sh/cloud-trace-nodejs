/**
 * Copyright 2018 Google LLC
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

import * as assert from 'assert';

import {bluebird_3 as BluebirdPromise} from '../../src/plugins/types';
import {Trace} from '../../src/trace';
import * as traceTestModule from '../trace';

/**
 * Describes a test case.
 */
interface TestCase {
  /**
   * Description of a test case; included in string argument to it().
   */
  description: string;
  /**
   * Creates and returns a new Promise.
   */
  makePromise: () => BluebirdPromise<void>;
  /**
   * Given a Promise and a callback, calls the callback some time after the
   * Promise has been resolved or rejected.
   */
  thenFn: (promise: BluebirdPromise<void>, cb: () => void) => void;
}

describe('Patch plugin for bluebird', () => {
  // BPromise is a class.
  // tslint:disable-next-line:variable-name
  let BPromise: typeof BluebirdPromise;

  before(() => {
    traceTestModule.setCLSForTest();
    traceTestModule.setPluginLoaderForTest();
    traceTestModule.start();
    BPromise = require('./fixtures/bluebird3');
  });

  after(() => {
    traceTestModule.setCLSForTest(traceTestModule.TestCLS);
    traceTestModule.setPluginLoaderForTest(traceTestModule.TestPluginLoader);
  });

  const testCases: TestCase[] = [
    {
      description: 'immediate resolve + child from then callback',
      makePromise: () => new BPromise(res => res()),
      thenFn: (p, cb) => p.then(cb)
    },
    {
      description: 'immediate rejection + child from then callback',
      makePromise: () => new BPromise((res, rej) => rej()),
      thenFn: (p, cb) => p.then(null, cb)
    },
    {
      description: 'immediate rejection + child from catch callback',
      makePromise: () => new BPromise((res, rej) => rej()),
      thenFn: (p, cb) => p.catch(cb)
    },
    {
      description: 'immediate rejection + child from finally callback',
      makePromise: () => new BPromise((res, rej) => rej()),
      thenFn: (p, cb) => p.catch(() => {}).finally(cb)
    },
    {
      description: 'deferred resolve + child from then callback',
      makePromise: () => new BPromise(res => setTimeout(res, 0)),
      thenFn: (p, cb) => p.then(cb)
    }
  ];

  testCases.forEach(testCase => {
    it(`enables context propagation in the same way as native promises for test case: ${
           testCase.description}`,
       async () => {
         const tracer = traceTestModule.get();
         // For a given Promise implementation, create two traces:
         // 1. Constructs a new Promise and resolves it.
         // 2. Within a then callback to the above mentioned Promise, construct
         // a child span.
         const getTracesForPromiseImplementation =
             (makePromise: () => BluebirdPromise<void>,
              thenFn: (promise: BluebirdPromise<void>, cb: () => void) => void):
                 Promise<[Trace, Trace]> => new Promise((resolve, reject) => {
                   let p: BluebirdPromise<void>;
                   const firstSpan =
                       tracer.runInRootSpan({name: 'first'}, span => {
                         p = makePromise();
                         return span;
                       });
                   tracer.runInRootSpan({name: 'second'}, secondSpan => {
                     // Note to maintainers: Do NOT convert this to async/await,
                     // as it changes context propagation behavior.
                     thenFn(p, () => {
                       tracer.createChildSpan().endSpan();
                       secondSpan.endSpan();
                       firstSpan.endSpan();
                       setImmediate(() => {
                         try {
                           const trace1 = traceTestModule.getOneTrace(
                               trace => trace.spans.some(
                                   root => root.name === 'first'));
                           const trace2 = traceTestModule.getOneTrace(
                               trace => trace.spans.some(
                                   root => root.name === 'second'));
                           traceTestModule.clearTraceData();
                           resolve([trace1, trace2]);
                         } catch (e) {
                           traceTestModule.clearTraceData();
                           reject(e);
                         }
                       });
                     });
                   });
                 });
         const actual = (await getTracesForPromiseImplementation(
                             testCase.makePromise, testCase.thenFn))
                            .map(trace => trace.spans.length)
                            .join(', ');
         // In each case, the second trace should have the child span.
         // The format here is "[numSpansInFirstTrace],
         // [numSpansInSecondTrace]".
         assert.strictEqual(actual, '1, 2');
       });
  });
});
