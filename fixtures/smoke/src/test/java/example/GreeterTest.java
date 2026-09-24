package example;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

public class GreeterTest {
  @Test
  public void returnsGreeting() {
    String message = Greeter.message();
    assertEquals("Hello Metals", message);
  }
}
