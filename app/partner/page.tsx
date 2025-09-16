"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AlertCircle, CheckCircle2 } from "lucide-react"

// Simple validation functions
const validateEmail = (email: string) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

const validatePhone = (phone: string) => {
  if (!phone) return true // Optional field
  const phoneRegex = /^[0-9+\-\s()]*$/
  return phoneRegex.test(phone) && phone.replace(/\D/g, "").length >= 10
}

type PartnerFormData = {
  type: "partner"
  firstName: string
  lastName: string
  email: string
  phone?: string
  interest: string
  message: string
  website_url?: string
}

const defaultValues: PartnerFormData = {
  type: "partner",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  interest: "",
  message: "",
  website_url: "",
}

export default function PartnerPage() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { toast } = useToast()

  const form = useForm<PartnerFormData>({
    defaultValues,
    mode: "onChange",
  })

  // Custom validation
  const validateForm = (data: PartnerFormData): string[] => {
    const errors: string[] = []

    if (!data.firstName || data.firstName.length < 2) {
      errors.push("First name must be at least 2 characters")
    }

    if (!data.lastName || data.lastName.length < 2) {
      errors.push("Last name must be at least 2 characters")
    }

    if (!validateEmail(data.email)) {
      errors.push("Please enter a valid email address")
    }

    if (data.phone && !validatePhone(data.phone)) {
      errors.push("Please enter a valid phone number")
    }

    if (!data.interest) {
      errors.push("Please select your area of interest")
    }

    if (!data.message || data.message.length < 10) {
      errors.push("Please provide at least a brief message")
    }

    return errors
  }

  const onSubmit = async (data: PartnerFormData) => {
    try {
      setIsSubmitting(true)

      // Validate form
      const validationErrors = validateForm(data)
      if (validationErrors.length > 0) {
        toast({
          title: "Validation Error",
          description: validationErrors[0],
          variant: "destructive",
          icon: <AlertCircle className="h-5 w-5" />,
        })
        return
      }

      // Submit the form data to our existing API endpoint
      const response = await fetch("/api/submit-partner-form", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.message || "Failed to submit form")
      }

      // Show success toast
      toast({
        title: "Success!",
        description: "Your partnership inquiry has been submitted successfully. We'll be in touch soon!",
        icon: <CheckCircle2 className="h-5 w-5 text-green-500" />,
      })

      // Reset form
      form.reset(defaultValues)
    } catch (error) {
      // Show error toast
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to submit form. Please try again.",
        variant: "destructive",
        icon: <AlertCircle className="h-5 w-5" />,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="container max-w-3xl py-16">
      <h1 className="text-4xl font-bold mb-6">Partner with Prime Champs</h1>
      <p className="text-muted-foreground mb-8">
        Whether you're an athlete looking for representation, a brand seeking partnerships, or an organization
        interested in collaboration, we'd love to hear from you.
      </p>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FormField
              control={form.control}
              name="firstName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    First Name <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Your first name" required />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="lastName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Last Name <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Your last name" required />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Email <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input {...field} type="email" placeholder="Your email address" required />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Phone (optional)</FormLabel>
                <FormControl>
                  <Input {...field} type="tel" placeholder="Your phone number" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="interest"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  I'm interested in <span className="text-destructive">*</span>
                </FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select an option" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="athlete">Athlete Representation</SelectItem>
                    <SelectItem value="brand">Brand Partnership</SelectItem>
                    <SelectItem value="sponsor">Sponsorship Opportunity</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="message"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Message <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    placeholder="Tell us more about your inquiry"
                    className="min-h-[150px]"
                    required
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Honeypot field - hidden from users but visible to bots */}
          <div className="hidden" aria-hidden="true">
            <FormField
              control={form.control}
              name="website_url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Website</FormLabel>
                  <FormControl>
                    <Input {...field} tabIndex={-1} autoComplete="off" />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>

          <div className="text-sm text-muted-foreground mb-4">
            <span className="text-destructive">*</span> Required fields
          </div>

          <Button type="submit" size="lg" disabled={isSubmitting}>
            {isSubmitting ? "Submitting..." : "Submit"}
          </Button>
        </form>
      </Form>
    </div>
  )
}
