/* Copyright 2016 Simon `svvac` Wachter (_@svvac.net)

 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:

 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.

 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENaze.
 * IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
 * CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
 * TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

const aze = require('aze');

let _smcount = 0;

class StateMachine {
    constructor(config) {
        const smid = `SM${_smcount++}`;
        this.$smid = smid;
        this.$states_str = aze.get(config, 'states', []);
        this.$states = {};
        this.$states_str.forEach((s, i) => this.$states[s] = i);

        this.$transition_whitelist = aze.get(config, 'transition_whitelist', null);
        this.$cascade_handlers = aze.get(config, 'cascade_handlers', false);

        if (aze.get(config, 'debug', false)) {
            this.$$debug = function () {
                console.log.apply(console, [ smid ].concat(Array.from(arguments)));
            };
        } else {
            this.$$debug = () => null;
        }

        // For the user
        this.state = {};

        this.$$n = null;
        this.$$np = null;

        this.$$event_queue = [];
        this.$$state_listeners = [];
        this.$$state_listeners_map_down  = {};
        this.$$state_listeners_map_up  = {};

        this.$state = aze.get(config, 'init_state', 0);
        this.$heartbeat = aze.get(config, 'heartbeat', false);
    }

    get $heartbeat() { return this.$$heartbeat_value; }
    set $heartbeat(v) {
        const tv = typeof v;
        if (tv !== 'number' && tv !== 'boolean' && t !== null && t !== undefined) {
            throw new TypeError('Invalid heartbeat interval')
        }

        if (!v || v < 1) v = false;

        if (v == this.$$heartbeat_value) return;

        this.$$debug('--', 'Setting heartbeat to', v);

        this.$$heartbeat_value = v;
        this.$$start_heartbeat();
    }

    $destruct() {
        this.$$stop_heartbeat();
    }

    $timeout(duration, token) {
        return this.$schedule(duration, '$timeout', token);
    }

    $schedule(duration, evt, payload) {
        this.$$debug('--', 'Scheduling', evt, 'in', duration);

        let timeout_cleared = false;
        const t = setTimeout(() => {
            timeout_cleared = true;
            this.$push(evt, payload)
        }, duration);
        const f = () => {
            if (timeout_cleared) return;
            timeout_cleared = true;
            clearTimeout(t);
        };

        f.evt = evt;
        f.payload = payload;
        f.duration = duration;

        return f;
    }

    $$add_listener(states, cb, remove, revert) {
        states = this.$$normalized_state_list(states);

        let handle = this.$$state_listeners.indexOf(null);
        if (handle < 0) handle = this.$$state_listeners.length;
        this.$$state_listeners[handle] = {
            cb: cb,
            remove: !!remove,
            triggered: false,
            bound_to: states,
            reversed: !!revert,
        };

        this.$$debug('--', 'Registered state change handler', handle);

        const map = revert ? this.$$state_listeners_map_down
                           : this.$$state_listeners_map_up;

        for (let state of states) {
            if (!(state in map))
                map[state] = [];

            map[state].push(handle);
            this.$$debug('--', 'Bound handler', handle, 'to', this.$states_str[state], revert ? 'down' : 'up');
        }

        return handle;
    }

    $remove_listener(handle) {
        if (!(handle in this.$$state_listeners))
            return null;

        const h = this.$$state_listeners[handle];

        for (let state of h.bound_to) {
            const map = h.reversed ? this.$$state_listeners_map_down
                                   : this.$$state_listeners_map_up;

            let idx = map[state].indexOf(handle);
            if (idx > -1) {
                map[state].splice(idx, 1);
                this.$$debug('--', 'Unbound handler', handle, 'from', this.$states_str[state], h.reversed ? 'down' : 'up');
           }
        }

        this.$$state_listeners[handle] = null;
        this.$$debug('--', 'Unregistered state change handler', handle);
        this.$$debug('--', 'State change handler', handle, 'was called', Number(h.triggered), 'times');

        return h;
    }

    $$process_state_change_events(prev, next) {
        const handles = (prev in this.$$state_listeners_map_down ? this.$$state_listeners_map_down[prev] : [])
                 .concat(next in this.$$state_listeners_map_up ? this.$$state_listeners_map_up[next] : [])

        for (let h of handles) {
            const handler = this.$$state_listeners[h];

            if (handler.remove && handler.triggered) continue;

            this.$$debug('--', 'Triggering state change handler', h);

            setImmediate(() => handler.cb.call(null, this, prev, next));
            handler.triggered += 1;

            if (handler.remove) {
                this.$remove_listener(h);
            }
        }
    }

    $on(states, cb) {
        return this.$$add_listener(states, cb, false, false)
    }
    $once(states, cb) {
        return this.$$add_listener(states, cb, true,  false);
    }
    $off(states, cb) {
        return this.$$add_listener(states, cb, false, true);
    }
    $once_off(states, cb) {
        return this.$$add_listener(states, cb, true,  true);
    }

    $is(states) {
        return this.$$state_is(this.$$n, arguments);
    }

    $$state_is(state, states) {
        return this.$$normalized_state_list(states).indexOf(state) > -1;
    }

    $$normalized_state_list(states) {
        if (typeof states === 'object' && 'callee' in states)
            states = Array.isArray(states[0]) ? states[0] : Array.from(states);

        if (!Array.isArray(states)) states = Array.from(arguments);

        return states.map((s) => {
            if (typeof s === 'number') {
                if (s in this.$states_str) return s;
            } else if (typeof s === 'string') {
                if (s in this.$states) return this.$states[s];
            }

            throw new Error('Unknown state ' + s);
        });
    }

    $push(evt, payload) {
        this.$$debug('--', 'Queued', evt);
        this.$$event_queue.push([ evt, payload ]);
        this.$$flush_queue_();
    }

    $$flush_queue_() {
        setImmediate(() => this.$$flush_queue());
    }

    $$flush_queue() {
        if (this.$$event_queue.length) {
            let e = this.$$event_queue.shift();
            this.$$tick(e[0], e[1]);
        }
    }

    $$start_heartbeat() {
        const interval = this.$heartbeat;
        this.$$stop_heartbeat();

        if (!interval) return;

        this.$$debug('--', 'Installing heartbeat');
        this.$$heartbeat_interval_h = setInterval(() => this.$$tick(null), interval);
    }

    $$stop_heartbeat() {
        if (!this.$$heartbeat_interval_h) return;

        this.$$debug('--', 'Uninstalling heartbeat');
        cancelInterval(this.$$heartbeat_interval_h);
        this.$$heartbeat_interval_h = null;
    }

    get $state() { return this.$$n }
    get $state_name() { return this.$states_str[this.$$n]; }
    set $state(v) { return this.$transition(v); }
    $transition(target) {
        this.$$smexcep_check();

        if (typeof target === 'string') {
            if (target in this.$states) {
                return this.$transition(this.$states[target]);
            }
        } else if (typeof target === 'number') {
            if (target in this.$states_str) {
                if (target === this.$$n) return this.$$n;

                // Check if transition is allowed
                if (this.$transition_whitelist) {
                    let valid = this.$transition_whitelist
                        .reduce((acc, trans) => acc
                            || this.$$state_is(this.$$n, trans[0])
                            && this.$$state_is(target,  trans[1]), false);

                    if (!valid) {
                        this.$panic('Forbidden transition');
                    }
                }

                this.$$np = this.$$n;
                this.$$n = target;
                this.$$debug('Transitionning to', this.$states_str[target]);
                this.$$process_state_change_events(this.$$np, this.$$n);
                return this.$$n;
            }
        } else if (target === undefined) {
            throw new Error('Can\'t transition to SMEXCEP: use .$panic()');
        }

        return this.$panic('Unknown state ' + target);
    }

    $$tick(evt, payload) {
        // unedefined state means the state machine encountered an unhandled
        // condition and therefore stopped since it will likely misbehave.
        // Stop with a state machine exception.
        if (this.$$n === undefined) {
            // Ignore heartbeat events when in SMEXCEP.
            if (evt === null) return;
            return this.$panic();
        }

        // Keep track of time
        //let time = process.hrtime();
        //time = this.$time = time[0] * 1e3 + time[1] / 1e6; // ms

        // Retrieve method, by order of preference:
        //
        // 1. __STATE_NAME__event_name() handles the event "event_name" when in
        //    state "STATE_NAME".
        // 2. __STATE_NAME__() handles all events when in state "STATE_NAME".
        // 3. ____event_name() handles all "event_name" events unless a more
        //    specific handler exists (e.g. 1. or 2.).
        //
        // The handler receives two parameters: the event identifier and the
        // event payload. They can act upon the state appropriately. See return
        // value requirements for handlers below.
        //
        // If an event was not explicitely handled by a handler, we still try
        // these with lower specificity afterwards if this.$cascade_handlers is
        // true
        //
        // By convention, state names are in caps, and event names in lowercase,
        // but feel free to do whatever. Class properties and methods with a
        // name starting in "$" and "$$" are reserved by this class so try not
        // to blow everything up.
        const method_list = [
            this.$$get_method(`__${this.$state_name}__${evt}`),
            this.$$get_method(`__${this.$state_name}__`),
            this.$$get_method(`____${evt}`),
        ];

        let ret;

        try {
            for (let method of method_list) {
                if (!method) continue;

                this.$$debug('Processing', evt, 'with', method.name);

                ret = method.call(this, evt, payload);

                // Test handling of the event
                // If it was handled, stop processing
                if (this.$$process_handler_return(ret, evt, payload)) {
                    return;
                }

                // Don't go further if not using cascading handlers
                if (!this.$cascade_handlers) break;
            }
        } catch (e) {
            console.error('Exception raised while in state', this.$state_name, 'handling event', evt);
            console.error(e);
            return this.$panic('Unhandled exception');
        }

        if (evt === null) {
            return;
        }

        // Defensive programming
        console.error('Unhandled condition for state', this.$state_name, 'with event', evt);
        console.error('Returned', ret);
        this.$panic();
    }

    $$process_handler_return(ret, evt, payload) {
        // handler function MUST return something upon handling an
        // event.
        //
        // * If it returns true, all good, we consider the event
        //   handled.
        // * If it returns a string or an array, we consider that as an
        //   event to be immediately triggered on the state machine.
        // * If false, immediately reemit the same event.
        //
        // Contrary to using $push(), the event is added at the
        // top of the event queue so that it is the next event that will
        // be fired on the state machine.
        //
        // Any other return value is invalid and will trigger a state
        // machine exception.

        if (ret === true) {
            return true;
        } else if (ret === false) {
            this.$$debug('Zero-transition');
            this.$$event_queue.unshift([ evt, payload ]);
            this.$$flush_queue_();
            return true;
        } else if (typeof ret === 'string') {
            this.$$debug('Zero-transition with event', ret);
            this.$$event_queue.unshift([ ret ]);
            this.$$flush_queue_();
            return true;
        } else if (Array.isArray(ret)) {
            this.$$debug('Zero-transition with event', ret[0]);
            this.$$event_queue.unshift(ret);
            this.$$flush_queue_();
            return true;
        }

        return false;
    }

    $panic(msg) {
        this.$$n = undefined;
        this.$$stop_heartbeat();
        throw new Error(msg || 'State machine exception');
    }

    $$smexcep_check() {
        if (this.$$n !== undefined) return;
        this.$panic();
    }

    $$get_method(name, rec) {
        if (typeof name === 'function') return name;

        const res = this[name];
        return typeof res === 'function' ? res
             : rec !== false && typeof res === 'string' ? this.$$get_method(res)
             : null;
    }

    // Convenience shorthand
    pass() { return true; }
}

module.exports = StateMachine;
