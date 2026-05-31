# memory management sucks, actually

memory management is one of the oldest problems in programming. every value your program creates has to live somewhere, and eventually that memory has to be reclaimed. the way a language handles this shapes everything: how you structure your data, how you design interfaces, how hard it is to refactor code, and how many runtime bugs you spend your days debugging.

there are four major families of memory management. manual memory management, where the programmer calls `malloc` and `free` by hand. raii and smart pointers, where object lifetimes are tied to scopes and ownership is transferred through types. borrow checking, where the compiler statically proves that every reference is valid without using a garbage collector. and garbage collection, where the runtime automatically traces which objects are still in use and frees the rest.

this post walks through all four of them. purity and totality, which i covered earlier in this series, will also have their links here later on.

## manual memory management

manual memory management is the most direct approach. you call `malloc` to request a block of memory from the heap, and you call `free` to return it when you are done. the operating system or a runtime allocator manages the underlying pages, but the programmer decides when each allocation begins and ends.

this gives you full control. you can place data in memory with exact alignment, reuse buffers to avoid allocation overhead, and release memory at precisely the right moment. that control is essential for kernels, firmware, and real-time systems where every microsecond and every byte matter.

the cost is correctness. there are no guardrails. if you use a block after freeing it, you get a use-after-free bug. if you free the same block twice, you corrupt the allocator's metadata. if you forget to free a block entirely, you leak memory. these are not rare corner cases; they happen in every large c or c++ codebase. developers run valgrind, address sanitiser, and static analysers as a standard part of the development loop, not as an occasional check. debugging a heap corruption that crashes the program ten minutes after the actual mistake is a specialised skill.

manual memory management also makes interfaces harder to design. if a function allocates an object and returns it, the caller must know to free it. this knowledge propagates across every layer of the call stack. a slight change in ownership semantics can require updating every caller. the compiler cannot help because it does not know the intended lifetime of the object; that information lives only in the programmer's head and in comments that inevitably fall out of date.

for all its difficulty, manual management remains the right choice in a narrow set of domains where the machine is the specification and no runtime overhead is acceptable. but for general-purpose programming, it is a poor default.

## raii and smart pointers

raii, resource acquisition is initialisation, is c++'s main answer to manual memory management. the idea is that every resource is owned by an object whose constructor acquires the resource and whose destructor releases it. when the object goes out of scope, the destructor runs automatically, even if an exception is thrown. this ties resource lifetime to lexical scope, which is a huge improvement over pairing every `malloc` with a matching `free`.

smart pointers build on raii to encode ownership semantics in the type system. `unique_ptr` owns an object exclusively and frees it when the pointer itself is destroyed. `shared_ptr` uses reference counting to free the object only when the last shared pointer to it disappears. `weak_ptr` can observe a `shared_ptr` without preventing its destruction, breaking cycles in the reference count.

this model works well for resources with a clear scoped lifetime: file handles, locks, temporary buffers, database connections. it eliminates many of the footguns of raw `malloc` and `free`, and it does so with minimal runtime overhead for unique ownership. reference counting adds some cost for shared pointers, both in atomic counter updates and in the cache misses those updates can cause.

the remaining difficulty is that raii still forces the programmer to choose the ownership model for every object. you must decide up front whether an object is uniquely owned or shared. you must watch for cycles among shared pointers, which will leak memory unless you manually insert `weak_ptr` to break them. changing ownership later often means touching many call sites. and some data structures, like graphs or actor-based systems, have lifetimes that do not fit neatly into a scope-based or reference-counted model. raii makes memory safer, but it does not make memory management disappear. overall, i'd argue it's a pretty neat model.

## the borrow checker

rust takes a different approach. it eliminates the need for a runtime garbage collector by checking ownership and borrowing at compile time. every value has a single owner at any given time. references to a value must not outlive the owner. you can have either one mutable reference or any number of immutable references, but never both simultaneously. these rules are enforced by the borrow checker, a static analysis that runs during compilation.

the benefit is memory safety without a runtime. use-after-free, double-free, null pointer dereferences, and data races are all ruled out by the type system. you can write a kernel, a browser engine, or a real-time audio processor in rust, and the compiler will guarantee the absence of those bugs. there is no garbage collector pausing your threads, and no reference counting overhead.

the cost is that the borrow checker is always on. it is not a tool you reach for when needed; it is a constraint that applies to every function, struct, and trait implementation you write. the moment you store a reference in a struct, you must annotate it with a lifetime parameter.

```rs
struct Iter<'a, T> {
    slice: &'a [T],
    index: usize,
}
```

the `'a` here is not domain logic. it is a mechanical fact about how long the slice lives relative to the iterator. the programmer must supply it because the compiler cannot always infer it, especially when multiple references interact.

lifetime annotations spread. if a function takes a struct with a lifetime, its signature must mention that lifetime. if you change the ownership pattern of a data structure, you must update the annotations through every call chain that touches it. this is manageable in small programs, but in large codebases it becomes a source of friction. the borrow checker also rejects many programs that are perfectly safe by a human's reasoning, forcing developers to restructure their code into shapes that the checker can prove. patterns like graphs, doubly linked lists, and callbacks that capture borrowed state become either impossible in safe rust or require explicit reference counting with `Rc` and `RefCell`, which pushes the problem back to runtime.

the borrow checker is a brilliant piece of engineering. for domains where the machine is the specification, it is the first credible alternative to c and c++ that does not sacrifice safety. but for application software, it extracts a constant cognitive tax. you are spending mental effort on memory management that the compiler could handle automatically if the language allowed a garbage collector.

## garbage collection

garbage collection is automatic memory management. the runtime tracks which objects are still reachable from the program's roots and reclaims the ones that are not. the programmer never writes a deallocation call.

there are several strategies. a tracing collector periodically walks the object graph, starting from the roots (global variables, the stack, registers), and marks every live object. unmarked objects are then swept and their memory is reused. a copying collector moves live objects to a new region of memory, compacting them and freeing the old region entirely. reference counting stores an integer counter in each object; when a reference to the object is created the counter increments, and when a reference is destroyed it decrements. when the counter hits zero, the object is freed immediately. generational collectors observe that most objects die young and divide the heap into a nursery and an old generation, collecting only the nursery most of the time. concurrent and parallel collectors do much of their work in background threads, reducing pause times.

the main advantage of garbage collection is that it makes memory management the runtime's problem instead of the programmer's. you allocate objects and use them; the collector determines when they are no longer needed. this eliminates use-after-free, double-free, memory leaks from forgotten deallocations, and the whole class of bugs that manual memory management creates. it also simplifies interfaces, because you never need to decide whether a function or its caller is responsible for freeing a returned value.

the traditional disadvantage is performance. early garbage collectors, like the stop-the-world mark-and-sweep collectors in early java virtual machines, could pause the program for several seconds during a full collection. this made gc unsuitable for real-time or latency-sensitive systems. collectors also add memory overhead, both for metadata and for the headroom needed to run collections efficiently. they can reduce cache locality, since they place objects without regard to the access patterns the programmer might have optimised by hand.

modern garbage collectors have dramatically reduced these costs. generational collectors make minor collections extremely fast, often a fraction of a millisecond. concurrent collectors like zgc, shenandoah, and go's gc perform nearly all their work while the application is running, with pause targets measured in microseconds. precise pointer tracking ensures the collector sees only real pointers, avoiding false roots and unnecessary object retention. jit-compiled runtimes use escape analysis to stack-allocate objects that do not escape their creating function, reducing allocation pressure on the gc entirely. on a modern go or java server, garbage collection overhead is typically between one and three percent of total cpu time, and pauses are smaller than a page fault.

garbage collection is not suitable for every domain. kernels, real-time control systems, and audio processing pipelines often need guaranteed response times that even the best concurrent collectors cannot provide. but for web services, data pipelines, user interfaces, and most application logic, modern gc is fast enough and far safer than the alternatives.

## all of these suck

look at the landscape. manual memory management gives you total control and a permanent background radiation of use-after-free, double-free, and leaks. raii and smart pointers make scoped resources safe, but you still spend brainpower choosing between unique, shared, and weak pointers, and a cycle in your shared pointers silently leaks memory. the borrow checker proves memory safety at compile time, which is amazing, but the proof obligation infects every function signature with lifetime annotations that have nothing to do with your domain logic, and it rejects plenty of programs that a human would recognise as perfectly fine. garbage collection frees you from all of that, but the classic tracing collectors introduce pauses and memory overhead that can be hard to predict, and even modern concurrent collectors still can't give you the hard real-time guarantees of a malloc/free pair.

none of these four approaches are wrong. but each of them asks the programmer to carry a burden that, in an ideal world, the language would carry for you.

## the ideal

let's try inventing a new kind of memory management, then? bear with me for a second.

so going back earlier in this series, i wrote about purity and totality. pure functions never mutate data; they can only create new values. total functions always return a result. algebraic effects push side effects out of the core language and into handlers, so the logic that describes your program stays pure. if you take these properties seriously, something profound happens to memory. you can never create a reference cycle. a cycle requires mutating object a to point to object b after b already points to a, and purity forbids that mutation.

### what does this mean?

so... wait a minute. the entirety of the live heap is _always_ a directed acyclic graph...? no cycles? ever?

this isn't a property i baked in separately; it falls out _for free_ from the decision to make the language pure. once the heap is a dag, basically every hard problem in memory management vanishes.

the first thing to notice is that a dag has no back-edges. an object can point to other objects, but nothing can point back to it after the fact. this makes lifetime reasoning dramatically simpler. in a language with mutation, an object's lifetime is hard to pin down because someone could later stash a reference to it inside a global, a closure, or a sibling, creating a hidden root that keeps the object alive. purity shuts that door entirely. the set of references to an object is fully determined at the moment it is created. no future code can add more. so if, at that moment, the only references come from a single enclosing scope, then the object's lifetime is exactly that scope. it will become unreachable exactly when the scope exits, no earlier, no later.

this is why regions work. a region is just a bump-allocated arena whose lifetime matches a particular scope. you fill it with objects that do not outlive the scope. the compiler can tell which objects those are because it sees the entire reference graph and knows that no external pointer will ever appear later. in a language with mutation, escape analysis is always approximate; you have to assume the worst because a mutable store could capture a reference anytime. in a pure language, the analysis is exact. the compiler can look at a freshly constructed value, trace all the places its reference will be used, and decide: does any reference path leave the current region? if not, the value stays local. the region bump pointer moves forward, and when the scope ends, the whole region is freed in one constant-time operation.

this eliminates the tracing overhead entirely for the vast majority of allocations. think about a typical functional program: enormous numbers of intermediate lists, tuples, and closure environments are created and discarded within the space of a few function calls. under a tracing gc, those objects pile up in a nursery and eventually trigger a minor collection. under a borrow checker, the compiler must prove each one doesn't escape, often requiring lifetime annotations on the function signatures. under the region model, they just live and die with the stack frame that created them. no scan, no annotation, no reference count, just a pointer reset!

of course, some objects genuinely need to escape. a value returned from a function, stored in a global structure, or captured by a long-lived algebraic effect handler must persist after its creating region is gone. for these, we fall back to reference counting. and here the dag property pays off again: without cycles, reference counting is complete. you never need a backup tracing pass to collect cyclic garbage; a counter reaching zero always means the object is unreachable. the compiler inserts the increment and decrement operations exactly where references cross region boundaries, and the programmer never writes a single `retain` or `release`. it's fully automatic.

so the entire memory model reduces to two simple policies: bump-allocate locally and reset at scope exit for everything that doesn't escape; reference count globally for everything that does. the compiler makes the choice by inspecting the pure dataflow, and the guarantee that no future mutation will disturb that analysis makes the separation sound. you get the constant-time bulk deallocation of regions, the determinism of reference counting, and the complete absence of both lifetime annotations and stop-the-world pauses. purity didn't just make gc acceptable, it also made the whole argument of tracing vs. reference counting irrelevant by letting the compiler pick the best strategy for each object silently.

this is the part that should make you pause.

## a conclusion

we have spent decades treating memory management as a necessary evil: a tax on performance, a tax on safety, a tax on sanity. but if purity really buys us this much structure, then the tax may not be fundamental at all. the entire battlefield might just be a consequence of letting values move in circles.
