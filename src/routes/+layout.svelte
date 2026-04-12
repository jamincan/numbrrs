<script lang="ts">
    import "../app.css";
    import { resolve } from "$app/paths";
    import favicon from "$lib/assets/favicon.svg";

    let { children } = $props();
</script>

<svelte:head>
    <link rel="icon" href={favicon} />
    <title>NumBrrs - Learn NHL Jersey Numbers</title>
</svelte:head>

<nav
    class="flex items-center justify-between bg-gray-950 px-6 py-3 text-sm text-gray-300"
>
    <a href={resolve("/")} class="font-bold text-white">NumBrrs</a>
</nav>

{@render children()}
