// The Grand Tour is the original full-world race. Everything else is one track at a time.
if (new URLSearchParams(location.search).has('tour')) void import('./tourMain')
else void import('./kart/main')
