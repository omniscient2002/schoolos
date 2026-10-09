/* ============================================================
   LanguageSwitcher — the persisted EN/HI toggle (Crew A, 0.6 + 3.1).
   Reads/writes the same schoolos.lang key as Settings (setLang /
   useLang in ./index), so the choice survives reloads and both
   surfaces stay in sync. EN maps to en-IN, HI maps to the short-code
   'hi' bundle; either Hindi code falls back through the other Hindi
   dictionary before English, and the partial-coverage note stays
   honest while Hindi is a scaffold.

   MOUNT POINT (not wired here — Shell.tsx is outside Crew A's
   allowlist): render <LanguageSwitcher /> inside ProfileMenu's
   account-menu dropdown in app/src/components/Shell.tsx, e.g.
   between the Settings row and the AppearanceMenu separator, or in
   the Settings "Account security" card next to the existing full
   language list:
     import { LanguageSwitcher } from '../i18n/LanguageSwitcher';
     …
     <LanguageSwitcher />
   ============================================================ */
import { LANGS, isPartial, setLang, t, useLang, type Lang } from './index';

const EN: Lang = 'en-IN';
const HI: Lang = 'hi';

export function LanguageSwitcher() {
  const lang = useLang();
  const isHI = lang !== EN;
  const hiEntry = LANGS.find(l => l.id === HI);
  return (
    <div>
      <div
        role="group"
        aria-label={t('settings.language', { fallback: 'Language' })}
        style={{ display: 'inline-flex', gap: 6 }}
      >
        <button
          type="button"
          aria-pressed={!isHI}
          onClick={() => setLang(EN)}
          className={isHI ? 'seg-btn' : 'seg-btn active'}
        >
          EN
        </button>
        <button
          type="button"
          aria-pressed={isHI}
          onClick={() => setLang(HI)}
          className={isHI ? 'seg-btn active' : 'seg-btn'}
          lang="hi"
        >
          हिन्दी{hiEntry && hiEntry.coverage < 1 ? ` · ${Math.round(hiEntry.coverage * 100)}%` : ''}
        </button>
      </div>
      {isPartial(lang) && (
        <div className="u-xs u-faint" style={{ marginTop: 6 }}>
          {t('settings.languagePartial', { fallback: 'Hindi covers a small part of the interface today — the rest stays in English.' })}
        </div>
      )}
    </div>
  );
}

export default LanguageSwitcher;
