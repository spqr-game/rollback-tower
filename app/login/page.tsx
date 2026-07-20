export default function Login() {
  return (
    <main>
      <h1>Sign in</h1>
      <form action="/api/login" method="post">
        <input type="password" name="password" aria-label="Password" />
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
