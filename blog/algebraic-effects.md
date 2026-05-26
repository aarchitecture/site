# algebraic effects

in my [last post](#post=blog%2Fmath-and-programming.md) i talked about purity and totality and why turning programming into math unlocks things like fearless refactoring, safe parallelism, and aggressive compiler optimizations. there is a catch: real programs have to do things. they read files, throw errors, keep state, log messages, and talk to the network. a completely pure, total program cannot even produce output without someone noticing.

this post describes a way to have your program do those things without giving up the mathematical guarantees. the idea is algebraic effects. they let you describe effectful computations without actually performing them, so your code stays pure and the actual side effects are pushed to swappable, composable handlers. think of it as treating side effects as first-class descriptions instead of invisible actions.

## effects as descriptions

in a pure functional language you cannot just call `print`. printing is a side effect. but what if `print` did not actually print? what if it only said it wanted to print, and something else later decided what that meant? that is the core idea.

instead of performing an effect immediately, you perform a symbolic operation that suspends your computation and yields control to a handler. the computation itself stays pure because it is just a data structure describing what to do. the handler interprets that description, possibly with real-world side effects.

here is the syntax. first you declare an effect:

```lua
effect Log
    log(message: string) -> ()
end
```

this declares an effect called `Log` with a single operation `log` that takes a string and returns nothing. you can then perform this effect inside a function:

```lua
function greet(name: string) -> () performs Log
    perform Log.log("saying hello to " .. name)
    print("hello, " .. name)
    perform Log.log("done")
end
```

the annotation `performs Log` says this function might do logging. notice that `greet` itself does not actually write anywhere. it just builds a description containing two `Log.log` operations. the `print` inside it is also an effect, but ignore that for now.

to actually run this, you provide a handler:

```lua
handle greet("alice")
    with handler
        on Log.log(message, resume):
            write_to_file("log.txt", message)
            resume(())
    end
```

the handler catches every `log` operation, performs the real i/o (the impure part), and then calls `resume` to continue the computation where it left off. `resume` is a first-class continuation because it represents the rest of the program after the `perform`. the handler can call it zero times, once, or many times, which will matter later.

## why this preserves purity

a function like `greet` can be understood purely because its meaning does not depend on when or if the logs are written. you could replace `greet("alice")` with a pure description value that just lists the operations:

```
Log.log("saying hello to alice")
print("hello, alice")
Log.log("done")
```

referential transparency holds because any call to `greet` with the same arguments yields exactly the same description. the only impure part is the handler that interprets it. this means you can still do all the nice things from the purity post: test the logic by swapping in a handler that collects logs into a list, inline the function without fear, or run it in parallel with other pure computations.

the types keep everyone honest. if a function says `performs Log`, you know it only depends on logging and nothing else. it cannot secretly mutate a global or throw an exception, because those would be different effects that are not in its signature.

## algebraic effects and totality

totality requires a function to return a value for every input, with no infinite loops and no exceptions. algebraic effects give you a neat way to turn partial operations into total ones by making the possibility of failure an explicit effect.

take the `first` example from last time, which crashed on an empty list. instead of returning `option<int>`, we can model the absence of an element as an effect:

```lua
effect Failure
    fail() -> nothing
end

function first(xs: list<int>) -> int performs Failure
    match xs
        case constructor(x, _):
            return x
        case empty:
            perform Failure.fail()
    end
end
```

now `first` is total for all lists. it never crashes; when the list is empty, it performs `fail`. the handler then decides what that means. it could abort with an error message, return a default value, or even retry with a different list. the function itself stays pure and total because it always produces a well-defined effect operation instead of trying to hide the partiality.

handlers can also enforce totality structurally. just as exhaustive pattern matching makes sure you cover all cases of a data type, a handler must provide a branch for every operation in the effect it handles. if you forget `fail`, the compiler rejects the program. this is the same exhaustive principle, now lifted to the effect level.

## state as an effect

global mutable state was the enemy of purity in the last post. with algebraic effects, state can be an effect whose implementation is hidden behind a pure interface.

```lua
effect State<a>
    get() -> a
    put(value: a) -> ()
end

function counter() -> () performs State<int>
    x = perform State.get()
    perform State.put(x + 1)
end
```

here `counter` reads and writes an integer state, but it is still a pure description. the handler can implement state in different ways: with a mutable reference cell, with an immutable state value threaded through, or even backed by a database. the logic of `counter` does not care.

a handler that uses a mutable cell might look like this:

```lua
handle counter()
    with handler
        state = 0
        on State.get(resume):
            resume(state)
        on State.put(new_value, resume):
            state = new_value
            resume(())
    end
```

the handler is the only part that is actually impure (it mutates a local variable). but `counter` itself is referentially transparent and testable. you can swap in a pure handler that returns the final state as a value without any mutation at all.

## non-determinism and multiple resumes

the `resume` continuation does not have to be called exactly once. you can call it multiple times to explore different execution paths, which gives you non-determinism without any special syntax.

```lua
effect Choose
    choose(xs: list<a>) -> a
end

function triple() -> int performs Choose
    x = perform Choose.choose([1, 2, 3])
    y = perform Choose.choose([10, 20])
    return x + y
end
```

a handler can now find all possible results:

```lua
handle triple()
    with handler
        on Choose.choose(xs, resume):
            results = []
            for x in xs do
                results.append(resume(x))
            end
            return results
    end
-- this gives all sums: [11, 21, 12, 22, 13, 23]
```

the computation `triple` remains pure and total. it never actually branches; it just describes a branching structure, and the handler explores it. the effect system tracks that `triple` only uses `Choose` and nothing else, so we know it cannot accidentally depend on, say, i/o.

## composition: no monad transformer hell

one of the historical solutions to purity plus effects is monads. monads work, but composing different monads (like state and logging) requires monad transformers, which can be clunky. algebraic effects compose for free. if you want state and logging, you just declare that your function performs both:

```lua
function do_stuff() -> () performs State<int>, Log
    perform Log.log("starting")
    n = perform State.get()
    perform State.put(n * 2)
    perform Log.log("finished")
end
```

the handler can be composed by nesting:

```lua
handle
    handle do_stuff()
        with state_handler
    with log_handler
```

or you can write a single handler that handles both effects at once if you want tighter integration. the order of handlers determines semantics (state inside log versus log inside state), but there is no need to restructure your program just to change the effect stack. this composability is a direct consequence of effects being algebraic; they form an algebra with simple laws for combining operations.

## what the compiler gets out of it

just like purity, algebraic effects give the compiler a lot of information. because effect types are explicit, the compiler knows exactly which effects a function might perform. it can:

- eliminate redundant effect operations. if two `Log.log` calls in a pure context have the same message, the compiler can merge them, because the description is a pure value.
- fuse handlers. if you are handling an effect only to re-perform it in an outer handler, the compiler can short-circuit that intermediate layer.
- parallelize independent effect sets. if two expressions have disjoint effect sets, they cannot interfere, so they can run in parallel without any synchronization.
- statically guarantee resource bounds. if an effect handler for concurrency uses a bounded number of fibers, and the effect signatures do not allow unbounded recursion on their own, the compiler can verify that the whole program will not diverge.

languages like Koka and OCaml 5 (with its effect handlers) compile effect operations down to efficient continuation passing, and the type system allows powerful inlining and specialization.

## a quick connection to algebraic data types

last time i talked about how algebraic data types let you model your domain precisely and then use exhaustive pattern matching to handle all cases. effects are like an interface of operations that form a signature, and handlers are like pattern matching on that signature. the operations are the cases, and the handler provides a branch for each one. exhaustiveness checking for handlers is exactly the same idea: do not forget an operation, or your program might get stuck at runtime.

structural recursion also shows up in effect handlers. many handlers are recursive in a way that mirrors the structure of the effectful computation: each time an operation is performed, the handler processes it and then recursively handles the rest of the computation. this structural recursion is often provably terminating, which brings us even closer to total programming.

## closing note

algebraic effects let you have purity, totality, and referential transparency while still writing programs that interact with the messy real world. instead of banning side effects, you describe them, and the actual execution is factored out into swappable, composable handlers.
