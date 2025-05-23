// root/src/lib/api.ts
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3337/api',
});

// After login, we call this to set basic auth for future requests
export function setCredentials(username: string, password: string) {
  api.defaults.auth = { username, password };
}

export default api;