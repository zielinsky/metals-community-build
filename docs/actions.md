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

Akcje operujące na symbolu (`hover`, `go-to-definition`, `go-to-implementation`, `find-references`, `type-hierarchy`, `code-action`, `document-highlight`) używają pierwszego wystąpienia `symbol` w pliku. Identyfikator musi pasować jako całe słowo, więc `Optional` nie trafi w `OptionalInt`. Opcjonalne pole `near` przesuwa wyszukiwanie do pierwszej linii zawierającej podany tekst, co pozwala wskazać późniejsze wystąpienie bez liczenia ich ręcznie.

## Lista

| kind | Co sprawdza | Zamknięte zgłoszenia Metals |
| --- | --- | --- |
| `mbt-import` | Import projektu do MBT, źródła i zależności w `mbt.json` | #8445, #8471, #8546 |
| `rename-symbol` | Zmiana nazwy symbolu | #8473, #8496 |
| `java-diagnostics` | Diagnostyka importów Javy i przypisanie pliku do targetu | #8453, #8491 |
| `java-test-discovery` | Wykrywanie testu | #8515 |
| `hover` | Dokumentacja pod kursorem | |
| `go-to-definition` | Przejście do definicji, także między modułami | #7917, #8442 |
| `go-to-implementation` | Przejście do implementacji | |
| `document-symbol` | Wyszukiwanie symbolu w pliku | |
| `completion` | Autouzupełnianie, automatyczny import, brak niepożądanych podpowiedzi | #6356, #7970, #8619 |
| `find-references` | Wyszukiwanie referencji symbolu w workspace | #8412 |
| `document-highlight` | Podświetlanie wystąpień symbolu w pliku | #8497, #8591 |
| `type-hierarchy` | Hierarchia typów z deklaracji i z miejsca użycia | #8503, #8558, #8665 |
| `code-action` | Code action, np. import brakującego symbolu | #8498, #8499, #8500, #8501 |
| `java-main-run` | Uruchomienie aplikacji Java, pojedyncze code lensy | #8389, #8476 |
| `java-debug-test` | Debugowanie testu Java | #8470, #8516 |

## `mbt-import` — Import projektu do MBT

Wybiera Use MBT, czeka na zakończenie importu i sprawdza model .metals/mbt.json: liczbę przestrzeni nazw, zależności i wskazane źródła. Opcjonalne `dependencies` to fragmenty identyfikatorów modułów zależności (np. `grupa:artefakt`), które muszą wystąpić w modelu lub w dowolnej przestrzeni nazw; wykrywa to brakujące biblioteki w eksporcie Bazela.

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
    ],
    "dependencies": [
      "org.junit.jupiter:junit-jupiter-api"
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

Sprawdza obecność wskazanych importów w źródle, otwiera Problems i wymaga braku błędów w tym pliku. Nie ignoruje błędów niezwiązanych z importami. `requireBuildTarget: true` dodatkowo wymaga, aby pasek stanu Metals nie pokazywał `no target` dla otwartego pliku, co wykrywa pliki z niestandardowych source setów pominięte w imporcie.

```json
{
  "id": "diagnostics",
  "kind": "java-diagnostics",
  "openFile": "src/test/java/example/GreeterTest.java",
  "imports": [
    "org.junit.jupiter.api.Test"
  ],
  "requireBuildTarget": true
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

Uruchamia Go to Definition i sprawdza pełną ścieżkę otwartego pliku oraz tekst na linii, na której wylądował kursor. Działa również z pliku Scala do źródła Javy w innym module.

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

Zastępuje jedyne wystąpienie replace tekstem prefix, otwiera podpowiedzi, wybiera item i sprawdza wstawiony expectedText. Nazwa item pasuje dokładnie, do nazwy metody przed nawiasem albo do nazwy przed spacją (etykiety automatycznych importów mają postać `Nazwa - pakiet`). Unikaj nawiasów w prefix, bo edytor domyka je automatycznie. Przywraca źródło i bufor edytora także po błędzie.

Opcjonalne `absentItems` wymienia podpowiedzi, których nie może być wśród widocznych pozycji listy, np. metod instancyjnych proponowanych na klasie.

```json
{
  "id": "completion",
  "kind": "completion",
  "openFile": "src/main/java/example/App.java",
  "completion": {
    "replace": "Greeter.message()",
    "prefix": "Greeter.m",
    "item": "message",
    "expectedText": "Greeter.message()",
    "absentItems": ["mutableMessage"]
  }
}
```

Opcjonalne `expectedImport` sprawdza automatyczny import: po zaakceptowaniu podpowiedzi plik musi zawierać `import <expectedImport>;`, a poza tą linią i expectedText nie może się różnić od oryginału (pomijając puste linie). Wykrywa to import wstawiony w środek deklaracji pakietu.

```json
{
  "id": "completion-auto-import",
  "kind": "completion",
  "openFile": "src/main/java/example/App.java",
  "completion": {
    "replace": "GREETING);",
    "prefix": "BigDec",
    "item": "BigDecimal - java.math",
    "expectedText": "BigDecimal",
    "expectedImport": "java.math.BigDecimal"
  }
}
```

Screen potwierdzający wynik: `*-completion-verified.png`.


## `find-references` — Wyszukiwanie referencji

Ustawia kursor na symbolu, uruchamia Peek References i odczytuje liczbę wyników z nagłówka podglądu. Wymaga co najmniej `minimumCount` referencji oraz, jeśli podano `files`, obecności tych plików wśród wyników. Wyszukiwanie obejmuje symbole z JDK i zależności, więc nadaje się do sprawdzania indeksu semanticdb całego workspace.

```json
{
  "id": "references",
  "kind": "find-references",
  "openFile": "src/main/java/example/App.java",
  "symbol": "Greeter",
  "references": {
    "minimumCount": 2,
    "files": ["src/test/java/example/GreeterTest.java"]
  }
}
```

Screen potwierdzający wynik: `*-references-verified.png`.


## `document-highlight` — Podświetlanie wystąpień

Ustawia kursor w symbolu i liczy podświetlenia dostarczone przez serwer języka (`wordHighlight`, `wordHighlightStrong`). Tekstowe podświetlenia VS Code (`wordHighlightText`), które pojawiają się bez providera, nie są zaliczane. Liczone są tylko wystąpienia widoczne w oknie edytora, więc wybierz symbol, którego wszystkie wystąpienia mieszczą się w okolicy kursora. Podświetlenie całego ciała konstruktora zamiast nazwy daje inną liczbę niż oczekiwana.

```json
{
  "id": "highlight",
  "kind": "document-highlight",
  "openFile": "src/main/java/example/App.java",
  "symbol": "GREETING",
  "highlight": {
    "expectedOccurrences": 2
  }
}
```

Screen potwierdzający wynik: `*-document-highlight-verified.png`.


## `type-hierarchy` — Hierarchia typów

Uruchamia Peek Type Hierarchy na symbolu, przełącza podgląd na `subtypes` albo `supertypes` przyciskiem w nagłówku i wymaga, aby na liście pojawiły się wszystkie nazwy z `expected`. Przykłady sprawdzają podtypy interfejsu z jego deklaracji oraz nadtypy klasy z miejsca użycia.

```json
{
  "id": "subtypes",
  "kind": "type-hierarchy",
  "openFile": "src/main/java/example/Greeting.java",
  "symbol": "Greeting",
  "hierarchy": {
    "direction": "subtypes",
    "expected": ["Greeter"]
  }
}
```

```json
{
  "id": "supertypes",
  "kind": "type-hierarchy",
  "openFile": "src/main/java/example/App.java",
  "symbol": "Greeter",
  "hierarchy": {
    "direction": "supertypes",
    "expected": ["Greeting"]
  }
}
```

Screen potwierdzający wynik: `*-type-hierarchy-verified.png`.


## `code-action` — Code action

Opcjonalnie najpierw zamienia jedyne wystąpienie `edit.replace` na `edit.with` i zapisuje plik, np. aby wprowadzić nierozwiązany symbol. Następnie ustawia kursor na symbolu, otwiera menu `quick-fix` (domyślne), `refactor` albo `source-action`, wybiera pierwszą akcję, której tytuł zawiera `title`, i wymaga `expectedText` w edytorze. Menu jest otwierane ponownie, dopóki Metals nie opublikuje akcji po diagnostyce. Przywraca źródło i bufor edytora także po błędzie.

```json
{
  "id": "import-missing-symbol",
  "kind": "code-action",
  "openFile": "src/main/java/example/App.java",
  "symbol": "List",
  "near": "List.of(GREETING)",
  "codeAction": {
    "edit": {
      "replace": "System.out.println(GREETING);",
      "with": "System.out.println(List.of(GREETING));"
    },
    "menu": "quick-fix",
    "title": "Import 'List' from package 'java.util'",
    "expectedText": "import java.util.List;"
  }
}
```

Screen potwierdzający wynik: `*-code-action-verified.png`.


## `java-main-run` — Uruchomienie aplikacji Java

Klika run przy main, wymaga successOutput w konsoli debugowania i zatrzymuje sesję po wykonaniu scenariusza. `uniqueCodeLenses: true` wymaga dokładnie jednego code lensu run i jednego debug w pliku, co wykrywa zduplikowane lensy.

```json
{
  "id": "run",
  "kind": "java-main-run",
  "openFile": "src/main/java/example/App.java",
  "main": {
    "className": "example.App",
    "successOutput": "Metals smoke started",
    "uniqueCodeLenses": true
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

Discovery i debug czekają do 120 s na ikonkę przy właściwej metodzie w już otwartym pliku. Nie zamykają i nie otwierają go ponownie, nie dopisują spacji i nie zapisują sztucznych zmian. Brak ikonki po tym czasie oznacza błąd scenariusza. Referencje, hierarchia typów i podświetlenia czekają do 60 s na wynik; code action jest ponawiany do 2 minut.

## Wyniki i screeny

Wyniki: `reports/local/<id>/result.json`. Screeny: `reports/local/<id>/screenshots/<scenario>/`. Każdy scenariusz ma własną numerację. Stare screeny są usuwane przed uruchomieniem. Obraz porażki powstaje przed sprzątaniem; komunikat błędu trafia do raportu.

```bash
npm run verify:screenshots -- reports/local/smoke
```

Walidator sprawdza poprawność PNG i obecność wymaganego screena końcowego. Nie dowodzi poprawności samych pikseli; treść UI jest sprawdzana przez akcję, a renderowanie należy obejrzeć.
