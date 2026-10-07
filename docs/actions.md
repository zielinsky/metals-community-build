# Akcje do testowania Metals

Wszystkie obsługiwane wartości `kind` są opisane poniżej. Przykłady pochodzą z `fixtures/smoke.json` i można je wkleić do tablicy `scenarios` manifestu projektu. Ścieżki są względne wobec `projectRoot`.

## Uruchamianie

```bash
npm test
npm run test:smoke -- --metals /path/to/metals
# Gdy właściwa wersja Metals jest już opublikowana lokalnie:
npm run test:smoke -- --skip-publish --skip-setup
# Wszystkie scenariusze konkretnego projektu:
npm run test:community -- --project selenium --workspace workspaces/selenium --skip-publish --skip-setup
# Jeden scenariusz (również zaczyna od świeżego importu):
npm run test:community -- --project fixtures/smoke.json --workspace workspaces/smoke --scenario completion --skip-publish --skip-setup
```

Ustaw `JAVA_HOME` na JDK zgodny z opublikowanym Metals. Runner usuwa całe `.metals` przed każdą sesją VS Code. Kolejne akcje w sesji współdzielą import. `required: true` oznacza, że błąd tej akcji pomija dalsze scenariusze; pozostałe błędy nie przerywają całej listy. Dla Bazela można ustawić `namespaceMode: "each-build-target"` lub `"single-global-target"`.

## Lista

| kind | Co sprawdza |
| --- | --- |
| `mbt-import` | Import projektu do MBT |
| `rename-symbol` | Zmiana nazwy symbolu |
| `java-diagnostics` | Diagnostyka importów Javy |
| `java-test-discovery` | Wykrywanie testu |
| `hover` | Dokumentacja pod kursorem |
| `go-to-definition` | Przejście do definicji |
| `go-to-implementation` | Przejście do implementacji |
| `document-symbol` | Wyszukiwanie symbolu w pliku |
| `completion` | Autouzupełnianie |
| `java-main-run` | Uruchomienie aplikacji Java |
| `java-debug-test` | Debugowanie testu Java |

## `mbt-import` — Import projektu do MBT

Wybiera Use MBT, czeka na zakończenie importu i sprawdza model .metals/mbt.json: liczbę przestrzeni nazw, zależności i wskazane źródła.

```json
{
  "id": "import",
  "kind": "mbt-import",
  "openFile": "src/test/java/example/GreeterTest.java",
  "required": true,
  "assertions": {
    "minimumNamespaces": 1,
    "sources": [
      "src/main/java/example/App.java",
      "src/test/java/example/GreeterTest.java"
    ]
  }
}
```

Screen potwierdzający wynik: `*-import-verified.png`.


## `rename-symbol` — Zmiana nazwy symbolu

Uruchamia Rename Symbol na pierwszym wystąpieniu symbolu, zapisuje plik i sprawdza liczbę wystąpień nowej nazwy oraz brak starej. Po scenariuszu przywraca źródło.

```json
{
  "id": "rename",
  "kind": "rename-symbol",
  "openFile": "src/main/java/example/App.java",
  "rename": {
    "symbol": "GREETING",
    "newName": "START_MESSAGE",
    "expectedOccurrences": 2
  }
}
```

Screen potwierdzający wynik: `*-rename-verified.png`.


## `java-diagnostics` — Diagnostyka importów Javy

Sprawdza obecność wskazanych importów w źródle, otwiera Problems i wymaga braku błędów w tym pliku. Nie ignoruje błędów niezwiązanych z importami.

```json
{
  "id": "diagnostics",
  "kind": "java-diagnostics",
  "openFile": "src/test/java/example/GreeterTest.java",
  "imports": [
    "org.junit.jupiter.api.Test"
  ]
}
```

Screen potwierdzający wynik: `*-imports-resolved.png`.


## `java-test-discovery` — Wykrywanie testu

Wymaga ikonki uruchomienia przy linii wskazanej metody, bez uruchamiania testu. Nie zalicza ikonki innej metody.

```json
{
  "id": "discovery",
  "kind": "java-test-discovery",
  "openFile": "src/test/java/example/GreeterTest.java",
  "testName": "returnsGreeting"
}
```

Screen potwierdzający wynik: `*-test-run-button-discovered.png`.


## `hover` — Dokumentacja pod kursorem

Otwiera Show or Focus Hover dla pierwszego wystąpienia symbolu i wymaga widocznej treści hoverText.

```json
{
  "id": "hover",
  "kind": "hover",
  "openFile": "src/main/java/example/App.java",
  "symbol": "Greeter",
  "hoverText": "Provides a greeting"
}
```

Screen potwierdzający wynik: `*-hover-verified.png`.


## `go-to-definition` — Przejście do definicji

Uruchamia Go to Definition i sprawdza pełną ścieżkę otwartego pliku oraz tekst na linii, na której wylądował kursor.

```json
{
  "id": "definition",
  "kind": "go-to-definition",
  "openFile": "src/main/java/example/App.java",
  "symbol": "Greeter",
  "definition": {
    "file": "src/main/java/example/Greeter.java",
    "text": "public class Greeter"
  }
}
```

Screen potwierdzający wynik: `*-definition-verified.png`.


## `go-to-implementation` — Przejście do implementacji

Uruchamia Go to Implementations i sprawdza plik oraz linię deklaracji implementacji. Przykład ma jedną implementację; wybór spośród wielu wyników nie jest obsługiwany. Pole definition opisuje oczekiwany cel nawigacji.

```json
{
  "id": "implementation",
  "kind": "go-to-implementation",
  "openFile": "src/main/java/example/Greeting.java",
  "symbol": "Greeting",
  "definition": {
    "file": "src/main/java/example/Greeter.java",
    "text": "public class Greeter"
  }
}
```

Screen potwierdzający wynik: `*-implementation-verified.png`.


## `document-symbol` — Wyszukiwanie symbolu w pliku

Wyszukuje symbol przez @ w Go to File, sprawdza listę wyników, akceptuje wynik i sprawdza tekst linii docelowej w tym samym pliku. Użyj nazwy jednoznacznej w pliku.

```json
{
  "id": "document-symbol",
  "kind": "document-symbol",
  "openFile": "src/main/java/example/Greeter.java",
  "symbol": "message",
  "expectedLine": "public static String message()"
}
```

Screen potwierdzający wynik: `*-document-symbol-verified.png`.


## `completion` — Autouzupełnianie

Zastępuje jedyne wystąpienie replace tekstem prefix, otwiera podpowiedzi, wybiera item i sprawdza wstawiony expectedText. Nazwa item pasuje dokładnie albo do nazwy metody przed nawiasem. Przywraca źródło i bufor edytora także po błędzie.

```json
{
  "id": "completion",
  "kind": "completion",
  "openFile": "src/main/java/example/App.java",
  "completion": {
    "replace": "Greeter.message()",
    "prefix": "Greeter.m",
    "item": "message",
    "expectedText": "Greeter.message()"
  }
}
```

Screen potwierdzający wynik: `*-completion-verified.png`.


## `java-main-run` — Uruchomienie aplikacji Java

Klika run przy main, wymaga successOutput w konsoli debugowania i zatrzymuje sesję po wykonaniu scenariusza.

```json
{
  "id": "run",
  "kind": "java-main-run",
  "openFile": "src/main/java/example/App.java",
  "main": {
    "className": "example.App",
    "successOutput": "Metals smoke started"
  }
}
```

Screen potwierdzający wynik: `*-application-started.png`.


## `java-debug-test` — Debugowanie testu Java

Ustawia breakpoint, wybiera Debug Test z menu ikonki testu, wymaga zatrzymania na dokładnie wskazanej linii, kontynuuje i sprawdza sukces testu. Na końcu usuwa breakpoint i zatrzymuje sesję.

```json
{
  "id": "debug",
  "kind": "java-debug-test",
  "openFile": "src/test/java/example/GreeterTest.java",
  "testName": "returnsGreeting",
  "breakpoint": {
    "line": 10
  }
}
```

Screen potwierdzający wynik: `*-debug-test-finished.png`.

## Brak ikonki testu i timeouty

Discovery i debug czekają do 120 s na ikonkę przy właściwej metodzie w już otwartym pliku. Nie zamykają i nie otwierają go ponownie, nie dopisują spacji i nie zapisują sztucznych zmian. Brak ikonki po tym czasie oznacza błąd scenariusza.

## Wyniki i screeny

Wyniki: `reports/local/<id>/result.json`. Screeny: `reports/local/<id>/screenshots/<scenario>/`. Każdy scenariusz ma własną numerację. Stare screeny są usuwane przed uruchomieniem. Obraz porażki powstaje przed sprzątaniem; komunikat błędu trafia do raportu.

```bash
npm run verify:screenshots -- reports/local/smoke
```

Walidator sprawdza poprawność PNG i obecność wymaganego screena końcowego. Nie dowodzi poprawności samych pikseli; treść UI jest sprawdzana przez akcję, a renderowanie należy obejrzeć.
