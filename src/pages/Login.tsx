// root/src/pages/Login.tsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";

const Login = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { login, isLoading, error } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const success = await login(username, password);
    if (success) navigate("/dashboard");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-primary">Logistics Management System</h1>
          <p className="text-muted-foreground mt-2">Sign in to your account</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Login</CardTitle>
            <CardDescription>Enter your credentials to access your account</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit}>
              <div className="grid gap-4">
                <div>
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    type="text"
                    placeholder="Username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                {error && <p className="text-destructive text-sm">{error}</p>}
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? "Signing in..." : "Sign in"}
                </Button>
              </div>
            </form>
          </CardContent>
          <CardFooter className="mt-2 text-center text-sm text-muted-foreground">
            <p>Demo Credentials:</p>
            <p>Logistics: aarnav / aarnav1729</p>
            <p>Vendor LEAFI: nav / nav</p>
            <p>Admin: aarnav / aarnav</p>
            <p>Vendor LEAFO: van / van</p>
          </CardFooter>
        </Card>
        <div className="mt-8 text-center text-sm text-muted-foreground">
          <a href="/terms" className="text-primary hover:underline">Terms and Conditions</a> |{" "}
          <a href="/contact" className="text-primary hover:underline">Contact Us</a>
        </div>
      </div>
    </div>
  );
};

export default Login;