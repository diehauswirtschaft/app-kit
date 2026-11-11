<script setup>
import logo from '../src/app_kit/assets/logo.svg'
import logoDark from '../src/app_kit/assets/logo-dark.svg'

defineProps({
  title: { type: String, required: true },
  userName: { type: String, default: '' },
  authenticated: { type: Boolean, default: false },
  logoutDisabled: { type: Boolean, default: false },
  loggingOut: { type: Boolean, default: false },
})
defineEmits(['logout'])
</script>

<template>
  <header class="dhw-header">
    <div class="dhw-header-inner">
      <!-- AP-02: no new brand-link reload may discard an active recording. -->
      <div class="dhw-brand">
        <picture class="dhw-brand-logo">
          <source media="(prefers-color-scheme: dark)" :srcset="logoDark">
          <img :src="logo" alt="die HausWirtschaft" width="1538" height="185">
        </picture>
        <span class="dhw-app-name">{{ title }}</span>
      </div>
      <nav aria-label="App-Navigation">
        <a href="https://start.dhw.wien">dHW Start</a>
        <span v-if="authenticated" class="dhw-header-user">{{ userName || 'Angemeldet' }}</span>
        <button v-if="authenticated" type="button" :disabled="logoutDisabled"
          :title="logoutDisabled ? 'Aufnahme zuerst beenden' : 'Hier abmelden'" @click="$emit('logout')">
          {{ loggingOut ? 'Wird abgemeldet…' : 'Hier abmelden' }}
        </button>
      </nav>
    </div>
  </header>
</template>
