<script setup>
import { computed } from "vue";

const props = defineProps({
  market: { type: String, required: true },
  symbol: { type: [String, Number], required: true },
  subtle: Boolean,
});

const marketSegment = computed(() => ({ "A Share": "a-share", "Hong Kong": "hk", US: "us" })[props.market] || String(props.market || "").toLowerCase());
const target = computed(() => ({ name: "stock-detail", params: { market: marketSegment.value, symbol: String(props.symbol).toUpperCase() } }));
</script>

<template><router-link class="stock-code-link" :class="{ subtle }" :to="target" target="_blank" rel="noopener noreferrer" @click.stop><slot>{{ symbol }}</slot></router-link></template>

<style scoped>
.stock-code-link{display:inline-flex;align-items:center;border:1px solid var(--app-border-strong);border-radius:6px;padding:2px 7px;background:var(--app-accent-bg);color:var(--app-accent-soft);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;font-weight:700;line-height:1.35;text-decoration:none;transition:border-color .16s ease,background .16s ease,transform .16s ease}.stock-code-link:hover{border-color:var(--app-accent);background:var(--app-hover);color:var(--app-text-strong);transform:translateY(-1px)}.stock-code-link.subtle{border-color:transparent;background:transparent;padding-inline:2px}
</style>
