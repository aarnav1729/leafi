
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

const Contact = () => {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    // Simulate form submission
    setTimeout(() => {
      setIsSubmitting(false);
      toast.success("Your message has been sent!");
      setName("");
      setEmail("");
      setMessage("");
    }, 1000);
  };

  return (
    <div className="container max-w-2xl py-12">
      <h1 className="text-3xl font-bold mb-6 text-center">Contact Us</h1>
      
      <Card>
        <CardHeader>
          <CardTitle>Get in touch</CardTitle>
          <CardDescription>
            Fill out the form below and we'll get back to you as soon as possible.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input 
                id="name" 
                value={name} 
                onChange={e => setName(e.target.value)}
                placeholder="Your name" 
                required 
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input 
                id="email" 
                type="email" 
                value={email} 
                onChange={e => setEmail(e.target.value)}
                placeholder="your.email@example.com" 
                required 
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="message">Message</Label>
              <Textarea 
                id="message" 
                value={message} 
                onChange={e => setMessage(e.target.value)}
                placeholder="How can we help you?" 
                required 
                rows={6}
              />
            </div>
            
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "Sending..." : "Send Message"}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button variant="ghost" onClick={() => navigate(-1)}>Back</Button>
          <div className="text-sm text-muted-foreground">
            We'll respond within 24 hours.
          </div>
        </CardFooter>
      </Card>
      
      <div className="mt-8 text-center">
        <h2 className="text-xl font-bold mb-2">Contact Information</h2>
        <p className="text-muted-foreground mb-1">Email: aarnav.singh@premierenergies.com</p>
        <p className="text-muted-foreground mb-1">Phone: +91 (814) 302-5550</p>
        <p className="text-muted-foreground">Address: 872 Trails End Rd, Eagan, MN 55104</p>
      </div>
    </div>
  );
};

export default Contact;
