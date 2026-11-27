<!-- AP-02: thin Svelte adapter over the same offline CSS/artwork as Vue/Jinja. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import logo from '../src/app_kit/assets/logo.svg';
  import logoDark from '../src/app_kit/assets/logo-dark.svg';
  import signet from '../src/app_kit/assets/signet.svg';
  import signetDark from '../src/app_kit/assets/signet-dark.svg';
  import { avatarPath, initials, installHeaderInteractions, cleanLegacyPortalEntry, guardHeaderExit, localNavLinks, moduleHomeHref, requirePortalHref, type PortalTarget, type HeaderGuard, type ModuleNavItem } from '../src/app_kit/assets/navigation.js';

  interface Props {
    title: string;
    userName?: string;
    userImage?: string | null;
    authenticated?: boolean;
    portalTarget: PortalTarget;
    pathname?: string;
    moduleHome?: string;
    stickyTabs?: boolean;
    moduleNav?: readonly ModuleNavItem[];
    avatarLinks?: readonly ModuleNavItem[];
    helpHref?: string;
    guard?: HeaderGuard;
    overviewActive?: boolean;
    profileActive?: boolean;
    mobileWordmark?: boolean;
  }
  let { title, userName = '', userImage = null, authenticated = false, overviewActive = false, profileActive = false, mobileWordmark = false, portalTarget, pathname = '/', moduleHome, stickyTabs = true, moduleNav, avatarLinks, helpHref, guard }: Props = $props();
  const portal = $derived(requirePortalHref(portalTarget));
  const appHome = $derived(moduleHomeHref(moduleHome));
  const tabs = $derived(localNavLinks(moduleNav, pathname, 5));
  const menu = $derived(localNavLinks([...(avatarLinks ?? []), ...(helpHref ? [{ label: `Hilfe zu ${title}`, href: helpHref }] : [])], pathname));
  const guardId = $props.id();
  const blocked = $derived(guard?.mode === 'block');
  const link = (href: string) => blocked ? { role: 'link', tabindex: 0, 'aria-disabled': true as const, 'aria-describedby': guardId } : { href };
  function guardClick(event: MouseEvent) {
    if (event.target instanceof Element && event.target.closest('a[href], a[role="link"]')) guardHeaderExit(event, guard);
  }
  let mounted = $state(false);
  const imagePath = $derived(mounted ? avatarPath(userImage) : null);
  let loaded = $state<string | null>(null);
  let root: HTMLElement;
  onMount(() => {
    mounted = true;
    cleanLegacyPortalEntry(window.location, window.history);
    const cleanup = installHeaderInteractions(root);
    const submit = (event: SubmitEvent) => { guardHeaderExit(event, guard); };
    root.addEventListener('click', guardClick, true);
    root.addEventListener('submit', submit, true);
    return () => {
      root.removeEventListener('click', guardClick, true);
      root.removeEventListener('submit', submit, true);
      cleanup();
    };
  });
</script>

<header bind:this={root} class="dhw-header" data-dhw-sticky-tabs={stickyTabs ? '' : undefined} class:dhw-wordmark-mobile={mobileWordmark}>
  <div class="dhw-header-inner">
    <div class="dhw-brand-group">
      <div class="dhw-brand">
      <a class="dhw-portal-link" {...link(portal)} aria-label="Startseite">
        <picture class="dhw-brand-logo"><source media="(prefers-color-scheme: dark)" srcset={logoDark} /><img src={logo} alt="die HausWirtschaft" width="1538" height="185" /></picture>
        <picture class="dhw-brand-signet"><source media="(prefers-color-scheme: dark)" srcset={signetDark} /><img src={signet} alt="" width="306" height="185" /></picture>
      </a>
      <span class="dhw-app-separator" aria-hidden="true"></span>
      <a class="dhw-app-name" {...link(appHome)} aria-current={(appHome === '/' ? overviewActive : pathname === appHome) ? 'page' : undefined}>{title}</a>
      </div>
    </div>
    <nav aria-label="App-Navigation">
      {#if authenticated}
        <details class="dhw-profile" data-dhw-profile>
          <summary aria-label={`${imagePath && loaded === imagePath ? '' : `${initials(userName)} – `}Profilmenü für ${userName || 'Mitglied'}`} title="Profilmenü"><span hidden={imagePath !== null && loaded === imagePath}>{initials(userName)}</span>{#if imagePath}{#key imagePath}<img class="dhw-avatar-image" alt="" src={imagePath} hidden={loaded !== imagePath} onload={() => { loaded = imagePath; }} onerror={() => { loaded = null; }} />{/key}{/if}</summary>
          <div class="dhw-profile-panel">
            <span class="dhw-header-user">{userName}</span>
            <a {...link("/profil")} aria-current={profileActive ? 'page' : undefined}>Mein Profil</a>
            {#each menu as item (item.href)}<a {...link(item.href)} aria-current={item.current}>{item.label}</a>{/each}
            <!-- ASI-006: preserve the local portal logout endpoint and its
                 existing server-side CSRF/origin checks, never a shared cookie. -->
            <form method="POST" action="/auth/logout"><button type="submit" disabled={blocked} aria-describedby={blocked ? guardId : undefined}>Hier abmelden</button></form>
          </div>
        </details>
      {/if}
    </nav>
  </div>
  {#if tabs.length > 1}
    <div class="dhw-module-nav-frame" data-dhw-module-overflow="">
      <nav class="dhw-module-nav" aria-label={title}>
        {#each tabs as item (item.href)}<a {...link(item.href)} aria-current={item.current}><span>{item.label}</span>{#if item.shortLabel}<span class="dhw-nav-short">{item.shortLabel}</span>{/if}</a>{/each}
      </nav>
    </div>
  {/if}
  {#if blocked}<p class="dhw-nav-lock" id={guardId}>{guard?.message}</p>{/if}
</header>
