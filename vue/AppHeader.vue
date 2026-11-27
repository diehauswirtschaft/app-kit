<script setup>
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import logo from '../src/app_kit/assets/logo.svg'
import logoDark from '../src/app_kit/assets/logo-dark.svg'
import signet from '../src/app_kit/assets/signet.svg'
import signetDark from '../src/app_kit/assets/signet-dark.svg'
import { avatarPath, cleanLegacyPortalEntry, guardHeaderExit, initials, installHeaderInteractions, localNavLinks, moduleHomeHref, requirePortalHref } from '../src/app_kit/assets/navigation.js'

const props = defineProps({
  title: { type: String, required: true },
  userName: { type: String, default: '' },
  userImage: { type: String, default: null },
  authenticated: { type: Boolean, default: false },
  logoutDisabled: { type: Boolean, default: false },
  portalTarget: { type: String, required: true },
  pathname: { type: String, default: '/' },
  moduleHome: String,
  stickyTabs: { type: Boolean, default: true },
  moduleNav: { type: Array, default: () => [] },
  avatarLinks: { type: Array, default: () => [] },
  helpHref: { type: String, default: null },
  guard: { type: Object, default: null },
  loggingOut: { type: Boolean, default: false },
})
const emit = defineEmits(['logout', 'overview'])
const instance = getCurrentInstance()
function visitHome(event) {
  // Older Meeting consumers own the home transition within their SPA.
  if (appHome.value === '/' && instance.vnode.props?.onOverview) {
    event.preventDefault()
    emit('overview')
  }
}
const root = ref(null)
const portal = computed(() => requirePortalHref(props.portalTarget))
const appHome = computed(() => moduleHomeHref(props.moduleHome))
const tabs = computed(() => localNavLinks(props.moduleNav, props.pathname, 5))
const menu = computed(() => localNavLinks([...props.avatarLinks, ...(props.helpHref ? [{ label: `Hilfe zu ${props.title}`, href: props.helpHref }] : [])], props.pathname))
const exitGuard = computed(() => props.logoutDisabled ? { mode: 'block', message: 'Aufnahme zuerst beenden' } : props.guard)
const blocked = computed(() => exitGuard.value?.mode === 'block')
const guardId = useId()
const link = href => blocked.value ? { role: 'link', tabindex: 0, 'aria-disabled': true, 'aria-describedby': guardId } : { href }
function guardClick(event) {
  if (event.target.closest?.('a[href], a[role="link"]')) guardHeaderExit(event, exitGuard.value)
}
const avatar = computed(() => initials(props.userName))
const mounted = ref(false)
const loaded = ref(null)
const imagePath = computed(() => mounted.value ? avatarPath(props.userImage) : null)
let cleanup = () => {}
onMounted(() => {
  mounted.value = true
  cleanLegacyPortalEntry(window.location, window.history)
  cleanup = installHeaderInteractions(root.value)
})
onBeforeUnmount(() => cleanup())
</script>

<template>
  <header @click.capture="guardClick" ref="root" class="dhw-header" :data-dhw-sticky-tabs="stickyTabs ? '' : undefined">
    <div class="dhw-header-inner">
      <div class="dhw-brand-group">
        <div class="dhw-brand">
        <a class="dhw-portal-link" v-bind="link(portal)" aria-label="Startseite">
          <picture class="dhw-brand-logo"><source media="(prefers-color-scheme: dark)" :srcset="logoDark"><img :src="logo" alt="die HausWirtschaft" width="1538" height="185"></picture>
          <picture class="dhw-brand-signet"><source media="(prefers-color-scheme: dark)" :srcset="signetDark"><img :src="signet" alt="" width="306" height="185"></picture>
        </a>
        <span class="dhw-app-separator" aria-hidden="true"></span>
        <a class="dhw-app-name" v-bind="link(appHome)" :aria-current="appHome !== '/' && pathname === appHome ? 'page' : undefined" @click.exact="visitHome">{{ title }}</a>
        </div>
      </div>
      <nav aria-label="App-Navigation">
        <details v-if="authenticated" class="dhw-profile" data-dhw-profile>
          <summary :aria-label="`${imagePath && loaded === imagePath ? '' : `${avatar} – `}Profilmenü für ${userName || 'Mitglied'}`" title="Profilmenü"><span :hidden="imagePath !== null && loaded === imagePath">{{ avatar }}</span><img v-if="imagePath" :key="imagePath" class="dhw-avatar-image" alt="" :src="imagePath" :hidden="loaded !== imagePath" @load="loaded = imagePath" @error="loaded = null"></summary>
          <div class="dhw-profile-panel">
            <span class="dhw-header-user">{{ userName || 'Angemeldet' }}</span>
            <a v-for="item in menu" :key="item.href" v-bind="link(item.href)" :aria-current="item.current">{{ item.label }}</a>
            <button type="button" :disabled="blocked" :aria-describedby="blocked ? guardId : undefined" @click="guardHeaderExit($event, exitGuard) && $emit('logout')">{{ loggingOut ? 'Wird abgemeldet…' : 'Hier abmelden' }}</button>
          </div>
        </details>
      </nav>
    </div>
    <div v-if="tabs.length > 1" class="dhw-module-nav-frame" data-dhw-module-overflow>
      <nav class="dhw-module-nav" :aria-label="title">
        <a v-for="item in tabs" :key="item.href" v-bind="link(item.href)" :aria-current="item.current"><span>{{ item.label }}</span><span v-if="item.shortLabel" class="dhw-nav-short">{{ item.shortLabel }}</span></a>
      </nav>
    </div>
    <p v-if="blocked" class="dhw-nav-lock" :id="guardId">{{ exitGuard.message }}</p>
  </header>
</template>
