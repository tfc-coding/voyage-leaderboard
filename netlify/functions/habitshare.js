let cachedToken = null;
let tokenExpiry = 0;

const BASE_URL = "https://habitshare.herokuapp.com";
const REST_API = BASE_URL + "/api/v3/";

async function getToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry - 60000) return cachedToken;

  const { HABITSHARE_EMAIL: username, HABITSHARE_PASSWORD: password } = process.env;
  if (!username || !password) throw new Error("Missing HabitShare auth env vars");

  const res = await fetch(BASE_URL + "/rest-auth/login/", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HabitShare login failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  if (!data.key) throw new Error("No token key returned from HabitShare login");
  cachedToken = data.key;
  tokenExpiry = now + 3600 * 1000;
  return cachedToken;
}

async function apiFetch(url, token) {
  const res = await fetch(url, {
    headers: { "Authorization": "Token " + token, "Accept": "application/json" },
  });
  if (!res.ok) return null;
  return res.json();
}

export default async (req) => {
  try {
    const token = await getToken();

    const [myHabits, friends] = await Promise.all([
      apiFetch(BASE_URL + "/habits", token),
      apiFetch(REST_API + "friends", token),
    ]);

    const friendsList = Array.isArray(friends) ? friends : (friends?.results || friends?.data || []);

    const friendResults = await Promise.allSettled(
      friendsList.map(async (f) => {
        const id = f.id || f.uid;
        const habitData = await apiFetch(REST_API + "users/" + id, token);
        const habits = habitData?.habits || [];
        return {
          user_name: f.name || f.displayName || f.username || "Unknown",
          user_id: id,
          habits: Array.isArray(habits) ? habits : [],
        };
      })
    );

    const result = {
      my_habits: Array.isArray(myHabits) ? myHabits : (myHabits?.results || myHabits?.data || []),
      friends: friendResults.filter(r => r.status === "fulfilled").map(r => r.value),
      fetched_at: new Date().toISOString(),
    };

    return new Response(JSON.stringify(result), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = { path: "/api/habitshare" };
