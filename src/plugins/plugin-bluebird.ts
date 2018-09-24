import * as shimmer from 'shimmer';

import {PluginTypes} from '..';

import {bluebird_3} from './types';

type BluebirdModule = typeof bluebird_3&{prototype: {_then: Function;}};

const plugin: PluginTypes.Plugin = [{
  // Bluebird is a class.
  // tslint:disable-next-line:variable-name
  patch: (Bluebird, tracer) => {
    // any is a type arg; args are type checked when read directly, otherwise
    // passed through to a function with the same type signature.
    // tslint:disable:no-any
    const wrapIfFunction = (fn: any) =>
        typeof fn === 'function' ? tracer.wrap(fn) : fn;
    shimmer.wrap(Bluebird.prototype, '_then', (thenFn: Function) => {
      // Inherit context from the call site of .then().
      return function<T>(this: bluebird_3<T>, ...args: any[]) {
        return thenFn.apply(this, [
          wrapIfFunction(args[0]), wrapIfFunction(args[1]), ...args.slice(2)
        ]);
      };
    });
    // tslint:enable:no-any
  }
} as PluginTypes.Monkeypatch<BluebirdModule>];

export = plugin;
