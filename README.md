# Personal OS

Repo-ready MVP: Vanilla JS + Supabase + GitHub Pages.

## Struktura

- `index.html` — szkielet aplikacji
- `styles.css` — cały design
- `js/app.js` — UI i flow
- `js/state.js` — lokalny state / fallback
- `js/levels.js` — XP + levele finansowe
- `js/supabase.js` — auth + synchronizacja
- `js/config.js` — Project URL i Publishable key
- `supabase-schema.sql` — schema bazy
- `.nojekyll` — prosty deploy na GitHub Pages

## Deploy na GitHub Pages

1. Utwórz repo `personal-os`.
2. Wrzuć CAŁĄ zawartość tego folderu do root repo.
3. GitHub → Settings → Pages.
4. Source: `Deploy from a branch`.
5. Branch: `main`, folder: `/(root)`.
6. Zapisz.
7. Skopiuj adres GitHub Pages.

## Supabase Auth

W Supabase → Authentication → URL Configuration:

- `Site URL`: Twój pełny URL GitHub Pages, np. `https://login.github.io/personal-os/`
- `Redirect URLs`: dodaj ten sam URL.

Potem wejdź na stronę, wpisz email, kliknij Magic Link.

## Po pierwszym udanym logowaniu

W `js/config.js` możesz zmienić:

```js
export const ALLOW_SIGNUP = false;
```

Wtedy nowe konta nie będą tworzone automatycznie.

## Level system

XP:
- P1: +35
- P2: +20
- P3: +10
- `Ruch finansowy`: dodatkowo +10 XP

Level pokazuje **symboliczny / aspiracyjny etap finansowy**, a nie realny stan konta.
Realne `cash` jest pokazywane obok osobno z zakładki Finanse.
