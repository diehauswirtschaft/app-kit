<script setup>
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
    <strong>die HausWirtschaft · {{ title }}</strong>
    <nav aria-label="App-Navigation">
      <a href="https://start.dhw.wien">dHW Start</a>
      <span v-if="authenticated">{{ userName || 'Angemeldet' }}</span>
      <button v-if="authenticated" type="button" :disabled="logoutDisabled"
        :title="logoutDisabled ? 'Aufnahme zuerst beenden' : 'Hier abmelden'" @click="$emit('logout')">
        {{ loggingOut ? 'Wird abgemeldet…' : 'Hier abmelden' }}
      </button>
    </nav>
  </header>
</template>
