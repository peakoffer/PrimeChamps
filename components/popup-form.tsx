"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
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

// Form data types
type AthleteFormData = {
  type: "athlete"
  name: string
  email: string
  phone: string
  sport: string
  otherSport?: string
  experience: string
  socialFollowing: string
  instagram?: string
  tiktok?: string
  youtube?: string
  twitter?: string
  achievements: string
  sponsorships?: string
  goals: string
  message?: string
  website_url?: string
}

type BrandFormData = {
  type: "brand"
  name: string
  email: string
  phone: string
  company: string
  role: string
  website?: string
  industry: string
  budget: string
  targetSports: string
  campaignGoals: string
  targetAudience: string
  timeline: string
  message?: string
  website_url?: string
}

type FormData = AthleteFormData | BrandFormData

const defaultAthleteValues: AthleteFormData = {
  type: "athlete",
  name: "",
  email: "",
  phone: "",
  sport: "",
  otherSport: "",
  experience: "",
  socialFollowing: "",
  instagram: "",
  tiktok: "",
  youtube: "",
  twitter: "",
  achievements: "",
  sponsorships: "",
  goals: "",
  message: "",
  website_url: "",
}

const defaultBrandValues: BrandFormData = {
  type: "brand",
  name: "",
  email: "",
  phone: "",
  company: "",
  role: "",
  website: "",
  industry: "",
  budget: "",
  targetSports: "",
  campaignGoals: "",
  targetAudience: "",
  timeline: "",
  message: "",
  website_url: "",
}

interface PopupFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function PopupForm({ open, onOpenChange }: PopupFormProps) {
  const [formType, setFormType] = useState<"athlete" | "brand">("athlete")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { toast } = useToast()

  const form = useForm<FormData>({
    defaultValues: formType === "athlete" ? defaultAthleteValues : defaultBrandValues,
    mode: "onChange",
  })

  // Custom validation
  const validateForm = (data: FormData): string[] => {
    const errors: string[] = []

    if (!data.name || data.name.length < 2) {
      errors.push("Name must be at least 2 characters")
    }

    if (!validateEmail(data.email)) {
      errors.push("Please enter a valid email address")
    }

    if (!validatePhone(data.phone)) {
      errors.push("Please enter a valid phone number")
    }

    if (data.type === "athlete") {
      const athleteData = data as AthleteFormData
      if (!athleteData.sport) {
        errors.push("Please select your primary sport")
      }
      if (athleteData.sport === "other" && !athleteData.otherSport) {
        errors.push("Please specify your sport")
      }
      if (!athleteData.experience) {
        errors.push("Please select your experience level")
      }
      if (!athleteData.socialFollowing) {
        errors.push("Please select your following range")
      }
      if (!athleteData.achievements || athleteData.achievements.length < 10) {
        errors.push("Please provide at least a brief description of your achievements")
      }
      if (!athleteData.goals || athleteData.goals.length < 10) {
        errors.push("Please provide at least a brief description of your goals")
      }
    } else if (data.type === "brand") {
      const brandData = data as BrandFormData
      if (!brandData.company || brandData.company.length < 2) {
        errors.push("Company name must be at least 2 characters")
      }
      if (!brandData.role || brandData.role.length < 2) {
        errors.push("Please specify your role")
      }
      if (brandData.website && !brandData.website.startsWith("http")) {
        errors.push("Please enter a valid URL")
      }
      if (!brandData.industry) {
        errors.push("Please select your industry")
      }
      if (!brandData.budget) {
        errors.push("Please select your budget range")
      }
      if (!brandData.targetSports || brandData.targetSports.length < 1) {
        errors.push("Please specify target sports")
      }
      if (!brandData.campaignGoals || brandData.campaignGoals.length < 10) {
        errors.push("Please provide at least a brief description of your campaign goals")
      }
      if (!brandData.targetAudience || brandData.targetAudience.length < 10) {
        errors.push("Please provide at least a brief description of your target audience")
      }
      if (!brandData.timeline) {
        errors.push("Please select your timeline")
      }
    }

    return errors
  }

  const onSubmit = async (data: FormData) => {
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

      // Submit the form data
      const response = await fetch("/api/submit-form", {
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
        description: "Your form has been submitted successfully. We'll be in touch soon!",
        icon: <CheckCircle2 className="h-5 w-5 text-green-500" />,
      })

      // Reset form and close dialog
      form.reset(formType === "athlete" ? defaultAthleteValues : defaultBrandValues)
      onOpenChange(false)
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

  const switchFormType = (type: "athlete" | "brand") => {
    setFormType(type)
    form.reset(type === "athlete" ? defaultAthleteValues : defaultBrandValues)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center mb-4">Partner with Us</DialogTitle>
        </DialogHeader>

        <div className="mb-6 space-x-4 flex justify-center">
          <Button variant={formType === "athlete" ? "default" : "outline"} onClick={() => switchFormType("athlete")}>
            I'm an Athlete
          </Button>
          <Button variant={formType === "brand" ? "default" : "outline"} onClick={() => switchFormType("brand")}>
            I'm a Brand
          </Button>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Common Fields */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Full Name <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input {...field} required />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Email <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input type="email" {...field} required />
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
                    <FormLabel>
                      Phone <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input type="tel" {...field} required />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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

            {formType === "athlete" ? (
              <>
                <FormField
                  control={form.control}
                  name="sport"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Primary Sport <span className="text-destructive">*</span>
                      </FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select your primary sport" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="mma">MMA</SelectItem>
                          <SelectItem value="boxing">Boxing</SelectItem>
                          <SelectItem value="surfing">Surfing</SelectItem>
                          <SelectItem value="skateboarding">Skateboarding</SelectItem>
                          <SelectItem value="snowboarding">Snowboarding</SelectItem>
                          <SelectItem value="skiing">Skiing</SelectItem>
                          <SelectItem value="climbing">Climbing</SelectItem>
                          <SelectItem value="parkour">Parkour</SelectItem>
                          <SelectItem value="crossfit">CrossFit</SelectItem>
                          <SelectItem value="weightlifting">Olympic Weightlifting</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {form.watch("sport") === "other" && (
                  <FormField
                    control={form.control}
                    name="otherSport"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Specify Sport <span className="text-destructive">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Enter your sport" required />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <FormField
                  control={form.control}
                  name="experience"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Experience Level <span className="text-destructive">*</span>
                      </FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select your experience level" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="amateur">Amateur</SelectItem>
                          <SelectItem value="semi-pro">Semi-Professional</SelectItem>
                          <SelectItem value="professional">Professional</SelectItem>
                          <SelectItem value="elite">Elite/World Class</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-4">
                  <Label>Social Media Profiles</Label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="instagram"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input {...field} placeholder="Instagram @username" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="tiktok"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input {...field} placeholder="TikTok @username" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="youtube"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input {...field} placeholder="YouTube channel" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="twitter"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input {...field} placeholder="X/Twitter @username" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <FormField
                  control={form.control}
                  name="socialFollowing"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Total Social Media Following <span className="text-destructive">*</span>
                      </FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select your following range" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="0-10k">0-10k</SelectItem>
                          <SelectItem value="10k-50k">10k-50k</SelectItem>
                          <SelectItem value="50k-100k">50k-100k</SelectItem>
                          <SelectItem value="100k-500k">100k-500k</SelectItem>
                          <SelectItem value="500k-1m">500k-1M</SelectItem>
                          <SelectItem value="1m+">1M+</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="achievements"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Notable Achievements <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormDescription>List your top competitions, awards, records, or recognition</FormDescription>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="e.g., 2023 National Champion, World Record Holder, Featured in Sports Magazine..."
                          className="h-24"
                          required
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="sponsorships"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Current/Past Sponsorships</FormLabel>
                      <FormDescription>List any brand partnerships or sponsorships (if applicable)</FormDescription>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="e.g., Current ambassador for Brand X, Past collaboration with Brand Y..."
                          className="h-24"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="goals"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Career Goals <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormDescription>What are your athletic and brand partnership goals?</FormDescription>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="Share your short-term and long-term goals..."
                          className="h-24"
                          required
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="company"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Company Name <span className="text-destructive">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input {...field} required />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="role"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Your Role <span className="text-destructive">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="e.g., Marketing Director" required />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="website"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Company Website</FormLabel>
                      <FormControl>
                        <Input {...field} type="url" placeholder="https://" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="industry"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Industry <span className="text-destructive">*</span>
                      </FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select your industry" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="sports-equipment">Sports Equipment</SelectItem>
                          <SelectItem value="apparel">Apparel & Fashion</SelectItem>
                          <SelectItem value="nutrition">Nutrition & Supplements</SelectItem>
                          <SelectItem value="technology">Technology</SelectItem>
                          <SelectItem value="lifestyle">Lifestyle & Wellness</SelectItem>
                          <SelectItem value="beverages">Beverages</SelectItem>
                          <SelectItem value="automotive">Automotive</SelectItem>
                          <SelectItem value="financial">Financial Services</SelectItem>
                          <SelectItem value="entertainment">Entertainment</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="budget"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Annual Partnership Budget <span className="text-destructive">*</span>
                      </FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select your budget range" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="0-10k">$0-$10k</SelectItem>
                          <SelectItem value="10k-50k">$10k-$50k</SelectItem>
                          <SelectItem value="50k-100k">$50k-$100k</SelectItem>
                          <SelectItem value="100k-500k">$100k-$500k</SelectItem>
                          <SelectItem value="500k-1m">$500k-$1M</SelectItem>
                          <SelectItem value="1m+">$1M+</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="targetSports"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Target Sports <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormDescription>Which sports align with your brand?</FormDescription>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="e.g., MMA, Skateboarding, Surfing..."
                          className="h-24"
                          required
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="campaignGoals"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Campaign Goals <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormDescription>What are your main objectives for athlete partnerships?</FormDescription>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="e.g., Brand awareness, Product launches, Content creation..."
                          className="h-24"
                          required
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="targetAudience"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Target Audience <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormDescription>Describe your ideal customer demographic</FormDescription>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="e.g., Age range, interests, location..."
                          className="h-24"
                          required
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="timeline"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Partnership Timeline <span className="text-destructive">*</span>
                      </FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select your preferred timeline" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="immediate">Ready to start immediately</SelectItem>
                          <SelectItem value="1-3months">1-3 months</SelectItem>
                          <SelectItem value="3-6months">3-6 months</SelectItem>
                          <SelectItem value="6months+">6+ months</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            <FormField
              control={form.control}
              name="message"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Additional Information (Optional)</FormLabel>
                  <FormControl>
                    <Textarea {...field} className="h-24" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="text-sm text-muted-foreground mb-4">
              <span className="text-destructive">*</span> Required fields
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "Submitting..." : "Submit Application"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
