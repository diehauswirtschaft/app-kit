<!-- AP-02: thin Svelte adapter over the same offline CSS/artwork as Vue/Jinja. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import logo from '../src/app_kit/assets/logo.svg';
  import logoDark from '../src/app_kit/assets/logo-dark.svg';
  import signet from '../src/app_kit/assets/signet.svg';
  import signetDark from '../src/app_kit/assets/signet-dark.svg';
  import { initials, installHeaderInteractions } from '../src/app_kit/assets/navigation.js';

  interface Props {
    title: string;
    userName?: string;
    authenticated?: boolean;
    backHref?: string | null;
    overviewActive?: boolean;
    profileActive?: boolean;
    mobileWordmark?: boolean;
  }
  let { title, userName = '', authenticated = false, backHref = null, overviewActive = false, profileActive = false, mobileWordmark = false }: Props = $props();
  let root: HTMLElement;
  onMount(() => installHeaderInteractions(root));
</script>

<header bind:this={root} class="dhw-header" class:dhw-wordmark-mobile={mobileWordmark}>
  <div class="dhw-header-inner">
    <div class="dhw-brand-group">
      {#if backHref}<a class="dhw-back" href={backHref} aria-label="Zur Modulübersicht" title="Zur Modulübersicht"><span aria-hidden="true">←</span></a>{/if}
      <a class="dhw-brand" href="/" aria-label={`${title} – Startseite`} aria-current={overviewActive ? 'page' : undefined}>
        <picture class="dhw-brand-logo"><source media="(prefers-color-scheme: dark)" srcset={logoDark} /><img src={logo} alt="die HausWirtschaft" width="1538" height="185" /></picture>
        <picture class="dhw-brand-signet"><source media="(prefers-color-scheme: dark)" srcset={signetDark} /><img src={signet} alt="" width="306" height="185" /></picture>
        <span class="dhw-app-name">{title}</span>
      </a>
    </div>
    <nav aria-label="App-Navigation">
      {#if authenticated}
        <details class="dhw-profile" data-dhw-profile>
          <summary aria-label={`Profilmenü für ${userName || 'Mitglied'}`} title="Profilmenü"><span aria-hidden="true">{initials(userName)}</span></summary>
          <div class="dhw-profile-panel">
            <span class="dhw-header-user">{userName}</span>
            <a href="/profil" aria-current={profileActive ? 'page' : undefined}>Mein Profil</a>
            <!-- ASI-006: preserve the local portal logout endpoint and its
                 existing server-side CSRF/origin checks, never a shared cookie. -->
            <form method="POST" action="/auth/logout"><button type="submit">Hier abmelden</button></form>
          </div>
        </details>
      {/if}
    </nav>
  </div>
</header>
