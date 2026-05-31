# low-level programming is a failure

when you write low-level code, you are not just telling the computer what you want it to compute. you are also telling it exactly how to carry out that computation, step by step, down to the layout of memory and the order of operations. this is a failure of language design. for the vast majority of software, the job of a programming language should be to let you describe the computation clearly, and then let the compiler figure out the how. low-level languages refuse to do this; they force you to manually supply information that a well-designed language and compiler should already know, and in the process they permanently close off automatic optimisation.

quick note: examples will use loose pseudocode in a lua-like syntax for readability.

## the unnecessary how

take a simple operation: summing a list of numbers. in a low-level language like c, you might write this.

```c
int sum(int* arr, int n) {
    int s = 0;
    for (int i = 0; i < n; i++) {
        s += arr[i];
    }
    return s;
}
```

this code does more than sum a list. it specifies a sequential loop, an index variable, a fixed iteration order, and the assumption that the numbers live in a contiguous array. the programmer's intention was "add up all the elements"; the compiler cannot see that intention, because it sees a precise sequence of instructions. if the compiler wanted to split the work across cores, it would have to guess that the order of addition does not matter. if it wanted to fuse this loop with the next one, it would have to prove that the array is not aliased elsewhere. if it wanted to use a different data layout that is more cache-friendly, it would have to understand that the array pointer is only used here. all of these are risky assumptions the compiler cannot safely make.

now consider a description that only says what to compute.

```lua
function sum(xs: list<int>) -> int
    match xs
        case empty:
            return 0
        case constructor(x, rest):
            return x + sum(rest)
    end
end
```

this version says nothing about order, indexing, or memory. it defines the sum of a list structurally: an empty list sums to zero, and a non-empty list sums to the first element plus the sum of the rest. there is no loop, no pointer arithmetic, only the meaning of the operation. a compiler for this language is free to choose any evaluation strategy; it can rewrite the recursion into a loop, vectorise it, run it in parallel, or fuse it with surrounding code, because nothing in the source code blocks those choices. you gave the compiler the what and let it decide the how.

note that this freedom is not absolute. the compiler still needs to know that addition is associative if it wants to parallelise the reduction, and it may need to know whether floating-point reassociation is permitted. a high-level language can make those facts explicit through typeclass laws or compiler directives. the point is not that the compiler can do *anything*; the point is that the programmer is no longer *forced* to embed a single strategy directly into the source.

## what the compiler never learns

every low-level program contains information that the programmer knows but the language cannot express in a way the compiler can use. the programmer knows that two arrays never overlap in memory; they express that knowledge only by writing careful pointer arithmetic and hoping the aliasing analyser agrees. the programmer knows that a function depends on nothing but its inputs; they convey that only by avoiding global variables, except it's invisible to the compiler. the programmer knows that a loop is really an independent reduction; they write a sequential loop because the language has no other way to say "reduce".

when the compiler cannot see these facts, it must assume the worst. any function call might have side effects. any pointer might alias. any loop might depend on the exact order of iteration. these conservative assumptions block almost every interesting optimisation: reordering, caching, parallelisation, fusion. the language made implicit knowledge invisible, and the compiler pays the cost.

a language that separates semantics from execution strategy lets you state these facts directly. you can say "this function is independent of observable state" or "these two values never overlap," and the compiler can trust those guarantees. the knowledge becomes explicit and machine-checkable, and the optimisation surface widens accordingly.

## early commitment closes doors

low-level code forces early commitment. when you pick a memory layout, an allocation strategy, or an iteration pattern, you lock those choices into the source. a future compiler pass cannot restructure the memory layout of a struct if the code accesses fields by offset; the layout is part of the program's meaning. a future pass cannot fuse two loops if a mutable variable sits between them; the ordering is part of the program's observable behaviour. a future pass cannot parallelise a loop that was written as a strict sequential scan because the programmer had no other syntax to express the computation.

every manual decision is a door closed. a language that defers implementation choices leaves those doors open; the compiler can profile, specialise, and adapt without touching the source. the program says what it means, and the compiler decides how to carry it out on the hardware available today, and differently on the hardware of tomorrow.

## information is the real resource

people often think performance comes from manual control. i think performance comes from information. every optimisation a compiler performs is ultimately justified by some fact about the program: these values do not alias, this function is pure, this loop is independent, this object cannot escape. low-level languages force programmers to encode these facts indirectly, by writing code in a particular shape and hoping the compiler guesses correctly. high-level languages can expose the facts directly, allowing the compiler to act on them automatically and with certainty.

this shifts the debate. the argument is not "high-level languages are faster than low-level languages" at all; it is that high-level languages, by preserving more of the programmer's intent in a machine-readable form, give optimisers a richer set of facts to work with. when you write a structural recursion instead of a for-loop, you are not just being aesthetic; you are giving the compiler the information that the iteration is an independent reduction, information it can use to parallelise, fuse, or reschedule the work. when you write a pure function, you are not just avoiding bugs; you are telling the compiler that calls can be memoised, reordered, or speculated without risk. the language becomes a medium for communicating meaning to the machine, not just a notation for controlling it.

## the rust case: why the machine stays visible

rust is often presented as a solution to the failures of low-level languages. personally, i dislike it. it eliminates use-after-free, data races, and null pointer dereferences through a borrow checker and an affine type system. these are real problems, and rust solves them. but it solves them without raising the level of abstraction; the programmer must still supply the same machine-level information that c requires, and the language adds a proof obligation on top.

consider what the programmer actually does in rust. you decide whether a value lives on the stack or the heap, using `Box`, `Rc`, or `Arc`. the compiler tracks every reference through a lifetime system that models how long it remains valid. when inference is sufficient, the programmer writes no annotations at all. but when ownership is nontrivial (multiple owners, cyclic data, callbacks that capture borrowed state), the programmer must supply lifetime annotations explicitly and structure the code to satisfy the borrow checker's rules. the knowledge of how long a reference lives and who holds exclusive access is not always inferred; it is often manually provided.

more fundamentally, the borrow checker asks the programmer to think in terms of ownership and borrowing. these are not domain concepts. they are resource-management concepts, invented to reason about memory without a garbage collector. when you write a web service, you do not naturally think about which part of the request handler owns the database connection and which part borrows it. you think about getting a connection, using it, and returning it. the borrow checker forces you to re-encode your intent into a graph of lifetimes and exclusive accesses, which is a machine model dressed up in type theory. that is a bad abstraction for application code. it takes a genuine concern (managing resources safely) and makes it the central organising principle of every program, whether the resource is a file descriptor or a temporary string slice.

could the compiler infer all of this automatically? in many practical cases, region inference and escape analysis can determine lifetimes without annotations. but in the presence of complex aliasing or runtime-dependent sharing, full inference is undecidable. rust exists precisely because that domain (systems programming) needs the programmer to supply undecidable information. the language succeeds there. but for the application programmer, this is precisely the problem: the language demands information that is necessary only because the abstraction floor was set so close to the machine in the first place.

## the go approach: say less, let the runtime work

go takes the opposite approach, and it is instructive to see why it succeeds. go does not ask the programmer to specify memory layout, allocation site, or object lifetimes. you write structs and slices, and the compiler decides what goes on the stack and what escapes to the heap. you spawn goroutines, and the runtime decides how to schedule them across threads. the programmer describes the computation and the data flow; the compiler and runtime handle the rest.

go's escape analysis is particularly revealing. in c or rust, the programmer decides whether a value is stack-allocated or heap-allocated. in go, the compiler traces the flow of every value through the program. if a value never leaves its function, it stays on the stack. if it escapes, the compiler promotes it to the heap automatically. the programmer never writes a single allocation annotation. the knowledge of where the value needs to live was always present in the code structure; go's compiler simply extracts it instead of asking the programmer to declare it.

this is the right tradeoff for the vast majority of software. go gives up some peak performance compared to hand-tuned rust or c, but it gains an enormous amount in return: the programmer stops thinking about memory at all. the code describes business logic, not resource management. the compiler and runtime, which have global visibility, make decisions that a human would get wrong or would fail to update as the code changes. go is not a perfect language, but it gets the core insight right: the programmer should not be required to say things the toolchain can determine.

## the jit alternative: what luajit does instead

if low-level languages suffer from early commitment, just-in-time compilers like luajit solve the problem from the opposite direction. they observe the program as it runs, discover the invariants that matter, and generate code optimised for the data actually flowing through the system. the programmer never has to declare that a loop is parallelisable or that a variable is always an integer; the tracer records the runtime types and branch outcomes, speculatively compiles a fast path, and inserts guards to fall back if the assumptions break.

luajit's tracing jit works because lua gives it a clean semantics to start with. there are no manual memory regions, no pointer arithmetic, no fixed struct layouts. the language describes what the computation is; the runtime infers how to execute it efficiently on the current workload. the same program might get a different compilation strategy depending on whether it processes a short list or a massive array, a fact the programmer never encoded in the source. this is an example of what happens when you stop forcing the programmer to be the optimiser: the toolchain can adapt in ways no human would predict or maintain.

of course, this approach has limits. a tracing jit can only observe paths the program actually takes; cold paths remain unoptimised. and some invariants, such as aliasing guarantees across library boundaries, cannot be discovered at runtime. but the point stands: when the language does not force the programmer to hard-code implementation details, the system gains room to discover better implementations on its own.

## the c++ trap

c++ is the prime example what happens when you try to add high-level features on top of a low-level base. the language now has lambdas, ranges, coroutines, and smart pointers, but it can never discard the manual memory model, the raw pointer semantics, and the copy-vs-move tradeoffs that permeate every abstraction. writing a range pipeline in c++ still requires the programmer to think about iterator invalidation, lifetime extension of temporaries, and whether a view owns its data. the abstraction is paper-thin; the machine is always visible underneath.

this is not the fault of the committee or the compiler writers. it is a direct consequence of starting from a model where the programmer controls everything. each new feature must preserve backward compatibility with that model, so the language can never reach the level of automatic optimisation that go or a tracing jit can offer. c++ proves that you cannot evolve your way out of low-level; you have to start from a different set of defaults.

## where low-level still belongs

this is not a claim that low-level programming is useless. when the machine itself is the specification, direct control is necessary. operating system kernels, firmware, real-time control systems, and the lowest layers of language runtimes genuinely require manual management of registers, memory ordering, and syscall sequences because the abstraction stack ends there. rust earns its place in this space by making that manual control safer than c ever did.

but these domains are the exception. for the overwhelming majority of software, including application logic, data processing, web services, and user interfaces, the machine is not the point. the programmer's job is to express business rules and data transformations. dragging machine-level concerns into that work is a distraction that makes the program harder to understand, harder to change, and harder for the compiler to improve. the historical justification for low-level defaults was that compilers were too weak to generate good code; that is no longer true. go, luajit, and modern jit-based runtimes prove that a language can be high-level and fast enough, provided it gives the compiler enough room to do its job.

## closing note

an ideal language is one that takes this idea seriously. programs should describe computation without specifying evaluation strategy, memory layout, or parallelism. there should be no lifetime annotations, no manual allocation, and no borrow checker. the compiler receives the what and is free to choose the how. low-level programming failed not because it produced slow programs, but because it mistook proximity to the hardware for understanding of the problem. the future of performance is writing code closer to the meaning, and letting the machine figure out the rest.
