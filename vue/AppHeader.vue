<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import logo from '../src/app_kit/assets/logo.svg'
import logoDark from '../src/app_kit/assets/logo-dark.svg'
import signet from '../src/app_kit/assets/signet.svg'
import signetDark from '../src/app_kit/assets/signet-dark.svg'
import { capturePortalEntry, initials, installHeaderInteractions } from '../src/app_kit/assets/navigation.js'

const props = defineProps({
  title: { type: String, required: true },
  userName: { type: String, default: '' },
  authenticated: { type: Boolean, default: false },
  logoutDisabled: { type: Boolean, default: false },
  loggingOut: { type: Boolean, default: false },
})
defineEmits(['logout', 'overview'])
const root = ref(null)
const backHref = ref(null)
const avatar = computed(() => initials(props.userName))
let cleanup = () => {}
onMounted(() => {
  let storage = null
  try { storage = window.sessionStorage } catch { /* Optional UI state only. */ }
  const url = new URL(window.location.href)
  backHref.value = capturePortalEntry(url, storage)
  if (url.searchParams.has('entry')) { url.searchParams.delete('entry'); window.history.replaceState(window.history.state, '', url) }
  cleanup = installHeaderInteractions(root.value)
})
onBeforeUnmount(() => cleanup())
</script>

<template>
  <header ref="root" class="dhw-header">
    <div class="dhw-header-inner">
      <div class="dhw-brand-group">
        <!-- AP-02: the recorder lock applies to new exit controls too. -->
        <button v-if="backHref && logoutDisabled" class="dhw-back" type="button" disabled aria-label="Zur Modulübersicht" title="Aufnahme zuerst beenden"><span aria-hidden="true">←</span></button>
        <a v-else-if="backHref" class="dhw-back" :href="backHref" aria-label="Zur Modulübersicht" title="Zur Modulübersicht"><span aria-hidden="true">←</span></a>
        <div class="dhw-brand">
        <!-- AP-02: neither split target may bypass the recorder exit lock.
             The cosmetic hint selects only the fixed production/staging portal. -->
        <a class="dhw-portal-link" :href="backHref || 'https://start.dhw.wien/'" aria-label="Zur dHW Startübersicht" :aria-disabled="logoutDisabled || undefined" @click="logoutDisabled && $event.preventDefault()">
          <picture class="dhw-brand-logo"><source media="(prefers-color-scheme: dark)" :srcset="logoDark"><img :src="logo" alt="die HausWirtschaft" width="1538" height="185"></picture>
          <picture class="dhw-brand-signet"><source media="(prefers-color-scheme: dark)" :srcset="signetDark"><img :src="signet" alt="" width="306" height="185"></picture>
        </a>
        <span class="dhw-app-separator" aria-hidden="true"></span>
        <a class="dhw-app-name" href="/" :aria-label="`${title} – Startseite`" :aria-disabled="logoutDisabled || undefined" @click.prevent="!logoutDisabled && $emit('overview')">{{ title }}</a>
        </div>
      </div>
      <nav aria-label="App-Navigation">
        <details v-if="authenticated" class="dhw-profile" data-dhw-profile>
          <summary :aria-label="`Profilmenü für ${userName || 'Mitglied'}`" title="Profilmenü"><span aria-hidden="true">{{ avatar }}</span></summary>
          <div class="dhw-profile-panel">
            <span class="dhw-header-user">{{ userName || 'Angemeldet' }}</span>
            <a v-if="!logoutDisabled" href="https://start.dhw.wien/">dHW Start öffnen</a>
            <button type="button" :disabled="logoutDisabled" :title="logoutDisabled ? 'Aufnahme zuerst beenden' : 'Hier abmelden'" @click="$emit('logout')">{{ loggingOut ? 'Wird abgemeldet…' : 'Hier abmelden' }}</button>
          </div>
        </details>
      </nav>
    </div>
  </header>
</template>
