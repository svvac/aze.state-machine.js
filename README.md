
              __          __
      _______/  |______ _/  |_  ____
     /  ___/\   __\__  \\   __\/ __ \
     \___ \  |  |  / __ \|  | \  ___/
    /____ >  |__| (____  /__|  \_____>__    .__
        \/       _____ \/___    ____ |  |__ |__| ____   ____
                /     \\__  \ _/ ___\|  |  \|  |/    \_/ __ \
               |  Y Y  \/ __ \\  \___|   Y  \  |   |  \  ___/
               |__|_|  (____  /\___  >___|  /__|___|  /\___  >
                     \/     \/     \/     \/        \/     \/

Simple API for implementing event-processing state machines in JavaScript.

## Installation

    npm install --save aze.state-machine

or

    npm install --save git+https://github.com/svvac/aze.state-machine.git

Then

    const StateMachineBase = require('aze.state-machine');

## Usage

### Definition
In a nutshell, extend `StateMachineBase` and supply to the super constructor the
parameters defining the state machine.

    const StateMachineBase = require('aze.state-machine');
    class MyStateMachine extends StateMachineBase {
        constructor(config) {
            super({
                // Define the list of the states here. Convention is caps.
                states: [ 'A', 'B', 'C' ],
                // The state the machine starts in. Defaults to the first state
                init_state: 'A',
                // If set to a positive number, the machine will tick with a
                // heartbeat event (null event) on that interval (milliseconds)
                heartbeat: 1000,
                // Set this to print debug info for the state machine
                debug: true,
            });

            // Do the your initialization process here
        }
    }

Method and property names starting with `$$` are reserved for internal use by
the engine and should not be read or written to, nor called.

Method and property names starting with `$` are reserved for the public API of
the engine. These can be read or called, but should only written to when a
setter property exists.

The rest of the namespace is yours. We put an empty object at `this.state` if
you want to put stuff there.

### State

The current state of the machine is exposed by `this.$state`. It returns the id
of the of the current state. To get the name, lookup `this.$state_name`.

Transitionning to a different state is done by setting `this.$state`. You can
use state IDs or state names transparently.

There is also the `.$transition(state)` method that does exactly the same thing.

If you need to check if the machine is in a state (or in any of the states in a
list), use the `.$is(states...)` method:

    if (this.$is('B', 2)) {
        // We're in B or C state
    }
    if (this.$is([ 'B', 2 ])) {
        // Same thing
    }

### Events
You can tick the state machine by feeding it events through the `.$push()`
method. Supply it an event name (a string) and an optional payload (anything).

    this.$push('wakeup', 42);

By convention, event names are lowercase.

The `heartbeat` parameter to the constructor creates a timer that will feed the
special `null` event to the state machine at that interval. You can also set
`this.$heartbeat` to change it afterwards (set to `null` to deactivate).

### Handlers
For every processed event, the engine will look for a handler method in that
order:

1. A method `__STATE_NAME__event_name()` than handles `event_name` events when
   in state `STATE_NAME`;
2. A method `__STATE_NAME__()` that handles all events in state `STATE_NAME`;
3. A method `____event_name()` than handles all `event_name` events.

If a string property exists with one of these names, the engine will lookup a
method with that name. This is useful for having several states share the same
implementation.

The handler methods are passed two arguments; the event name and the payload.

#### Handler capacity
The handler can do pretty much anything to the state machine, including
transitionning and feeding events.

#### Zero-transitions
Sometimes an event might need examination by several states before processing
the next event. In order to tell the engine to retick with the same event,
return `false` from your handler method.

You can also return a string which will be interpreted as an event name to do a
zero-transition with, or a `[ event, payload ]` array.

This will (re-)add the event at the top of the event queue and tick the engine.

#### Defensive programming
The engine is implemented such that not *explicitely* handling a condition will
trigger a state machine exception (SMEXCEPT) that will block the engine. In that
case, `this.$state` is `undefined`.

You must then return `true` from your handler functions to tell the engine that
you have handled a case. Together with early-return programming style, this
helps avoid entering unexpected conditions that have not been explicitely
handled.

Doing a zero-transition is considered handling an event.

If the `null` (heartbeat) event is not handled, it is ignored and the machine
will not enter SMEXCEPT.
