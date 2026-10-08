package example;

/** Provides a greeting for the Metals smoke test. */
public class Greeter implements Greeting {
  /** Returns the greeting text. */
  public static String message() {
    return "Hello Metals";
  }

  /** Instance variant that must not be offered on the class itself. */
  public String mutableMessage() {
    return message() + "!";
  }
}
