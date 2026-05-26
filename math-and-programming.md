# math and programming

when you write code for computers, programming functions don't actually behave like mathematical functions. a function in code can depend on values that are not part of its arguments, and it can  alter memory that other functions rely on, and even fail to return a result for some inputs.

purity and totality are two constraints which people (idk who) invented to bring programming functions closer to their mathematical counterparts. this post is mostly about those two and why i love them.

quick note: examples will use loose random pseudocode lua-like syntax for readability.

## functions

in math, a function maps a domain to a codomain. every element of the domain maps to exactly one element of the codomain, meaning any passed input has only one output. the function f(x) = x^2 for example maps 2 -> 4, 3 -> 9, and also -3 -> 9

in programming, a function can be made to resemble this idea. when a programming function is pure, it satisfies two conditions:
1. deterministic output
2. no side effects

### deterministic output

what the first point means is that for the same arguments to the function, the function always returns the same value. an example of this is:

```lua
function add(a: int, b: int) -> int
    return a + b
end

print(add(2, 3)) -- 5
print(add(2, 3)) -- 5 again
```

here, `add(2, 3)` will always return the same value.
a counterexample would be:

```lua
count = 3

function add(x: int) -> int
    count = count + x
    return count
end

print(add(2)) -- 5
print(add(2)) -- 7
print(add(2)) -- 9
```

even though i called `add` with the same argument of `2` throughout, i got different results. you could also call this a "stateful" function, since it has some global "state" which it depends on, in this case `count`. to simplify, state acts like an implicit argument to your function. the original add, however, can be considered "stateless".

### no side effects

the second point means the function does not modify any observable state, meaning it cannot have any mutation of global variables, write to files, do network communication, or even throw exceptions.

side note: you might argue that whether exceptions count as side effects depends on the language and how they're modeled. but in genuinely pure systems, every input must produce a value. once you allow exceptions, you're admitting that some inputs fail to return anything at all.

you might wonder why network communication or writing to files counts here. the thing is, for a function to be _truly_ pure, it cannot affect the outside world or depend on mutable external state. to simplify, it cannot change anything outside itself.

### what's the point

basically, a pure function's result depends on _just_ its inputs. this property is called _referential transparency_; any call to the function can be replaced with its result without actually affecting the program's meaning. the function can be understood in isolation, tested without mocking, and optimized aggressively by the compiler. i can replace `add(2, 3)` with `5` throughout and my output will never change.

## totality

a function is _total_ if it returns a value for every element of its input type. no exceptions, crashies, or infinite loops. in mathematics, g(x) = 1/x is total on the domain of nonzero real numbers but partial on the domain of all reals because it is undefined at zero.

```lua
function first(xs: list<int>) -> int
    return xs[1]
end

print(first({1, 2, 3})) -- 1
print(first({}))        -- error
```

take this function, for example. in programming, the equivalent to a mathematically partial function is common; our function declared to accept a list and return an element, returns `nil` on an empty list, meaning it does not actually return a list element for every possible inputc. that function is partial.

its declared domain is "all lists", but there exist valid inputs for which it fails to produce a valid output. the true domain of `first` here is not "all lists", but maybe all "non-empty lists".

alternatively, the function itself could return an optional value, making failure explicit in the typt itself:

```lua
function first(xs: list<int>) -> option<int>
    if xs is empty then
        return none
    end

    return some(xs[1])
end

print(first({1, 2, 3})) -- some(1)
print(first({}))        -- none
```

## algebraic data types and exhaustic pattern matching

partiality often enters programs when they only handle some possible forms of their input. 

many programming languages let us define types as a set of possible variants. for example, an optional value might either be `some(value)` or `none`. a list might either be empty or a value followed by another list.

when a function inspects one of these types, it usually does this through so-called "pattern matching"; but if some possible patterns are ignored, the function is now partial.

for example, our old `first` function only handled the non-empty case. a total version must handle all possible variants explicitly:

```lua
function first(xs: list<int>) -> option<int>
    match xs
        case constructor(x, _):
            return some(x)

        case empty:
            return none
    end
end
```

this property is called _exhaustive pattern matching_: every possible shape of the input is accounted for. in languages with strong type systems, the compiler can even verify this automatically!

## structural recursion and termination

another way partiality enters programs is through non-termination. a function which loops forever never actually produces a value, meaning it is not total.

```lua
function loop_forever() -> int
    while true do
    end
end
```

this function has a return type of `int`, but in reality it never returns anything at all.

one common way functional programs avoid this problem is through *structural recursion*. this means recursive functions must operate on progressively smaller pieces of their input structure.

for example, consider a function which sums a list:

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

each recursive call operates on `rest`, which is a smaller list than before. eventually, the recursion reaches the `empty` case and stops.

this matters because the function's structure itself gives evidence that it will terminate. recursion is not just happening randomly; it is consuming the input step by step until no input remains.

compare this to something like:

```lua
function f(x: int) -> int
    return f(x)
end
```

here, nothing changes between recursive calls. there is no progress toward a base case, so the function never terminates.

in some languages, especially proof assistants and dependently typed languages, the compiler can actually verify that recursive functions are structurally decreasing and therefore guaranteed to terminate. this allows totality to be enforced mechanically rather than treated as a convention.

## why are we turning programming into math?

the thing is, purity and totality are not just theoretical niceties; they give the compiler knowledge that enables specific, concrete optimizations. because pure functions are referentially transparent, the compiler can replace any call with its result, inline functions, and eliminate redundant computations without changing program behavior. this simplifies both manual refactoring and automatic optimization.

moreover, pure functions have no shared mutable state. two independent pure computations can execute in parallel with zero risk of data races. the compiler or runtime can automatically split a map over a large array across multiple cores without any threading primitives in the source code. the result is deterministic regardless of scheduling.

another thing is that a tracing JIT compiler can profile hot code paths and speculatively inline functions, assuming specific types or branch outcomes. if the assumption proves wrong, detected by a guard check, execution can roll back to a safe interpreter state. because the functions involved are pure, this speculation has no observable side effects, so rollback is always safe.

total functions can also just not loop infinitely. this is a hard requirement in some domains (embedded systems, safety-critical software) where resource bounds must be statically known.

these benefits are not a matter of compiler cleverness alone; they are direct consequences of the definitions. when mutation and partiality are the default, the compiler must conservatively assume that any function call could have side effects or could fail, which limits the optimizations that can be applied.

## closing note

these concepts, purity, totality, algebraic data types, and structural recursion, are some things i'm actually using to make this one language i'm working on, called "Quetta" (named after the metric prefix for 10^30). if i ever release it, you'll definitely see all of these things in there
