<script lang="ts">
    type Props = {
        bg?: string;
        color?: string;
        class?: string;
    };

    let { bg = "#0f172a", color = "white", class: cls = "" }: Props = $props();
</script>

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class={cls}>
    <rect width="100" height="100" rx="18" fill={bg} />
    <rect x="32" y="14" width="9" height="72" rx="3" fill={color} />
    <rect x="59" y="14" width="9" height="72" rx="3" fill={color} />
    <rect x="18" y="32" width="64" height="9" rx="3" fill={color} />
    <rect x="18" y="59" width="64" height="9" rx="3" fill={color} />
</svg>
