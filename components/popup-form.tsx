"use client";

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const athleteFormSchema = z.object({
  type: z.literal('athlete'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  phone: z.string().min(10, 'Please enter a valid phone number'),
  sport: z.string().min(1, 'Please select or specify your sport'),
  otherSport: z.string().optional(),
  experience: z.string().min(1, 'Please select your experience level'),
  socialFollowing: z.string().min(1, 'Please select your following range'),
  instagram: z.string().optional(),
  tiktok: z.string().optional(),
  youtube: z.string().optional(),
  twitter: z.string().optional(),
  achievements: z.string().min(10, 'Please list your notable achievements'),
  sponsorships: z.string().optional(),
  goals: z.string().min(10, 'Please describe your goals'),
  message: z.string().optional(),
});

const brandFormSchema = z.object({
  type: z.literal('brand'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  phone: z.string().min(10, 'Please enter a valid phone number'),
  company: z.string().min(2, 'Company name must be at least 2 characters'),
  role: z.string().min(2, 'Please specify your role'),
  website: z.string().url('Please enter a valid URL').optional(),
  industry: z.string().min(1, 'Please select your industry'),
  budget: z.string().min(1, 'Please select your budget range'),
  targetSports: z.string().min(1, 'Please specify target sports'),
  campaignGoals: z.string().min(10, 'Please describe your campaign goals'),
  targetAudience: z.string().min(10, 'Please describe your target audience'),
  timeline: z.string().min(1, 'Please select your timeline'),
  message: z.string().optional(),
});

const formSchema = z.discriminatedUnion('type', [
  athleteFormSchema,
  brandFormSchema,
]);

const defaultAthleteValues = {
  type: 'athlete' as const,
  name: '',
  email: '',
  phone: '',
  sport: '',
  otherSport: '',
  experience: '',
  socialFollowing: '',
  instagram: '',
  tiktok: '',
  youtube: '',
  twitter: '',
  achievements: '',
  sponsorships: '',
  goals: '',
  message: '',
};

const defaultBrandValues = {
  type: 'brand' as const,
  name: '',
  email: '',
  phone: '',
  company: '',
  role: '',
  website: '',
  industry: '',
  budget: '',
  targetSports: '',
  campaignGoals: '',
  targetAudience: '',
  timeline: '',
  message: '',
};

interface PopupFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function PopupForm({ open, onOpenChange }: PopupFormProps) {
  const [formType, setFormType] = useState<'athlete' | 'brand'>('athlete');
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: formType === 'athlete' ? defaultAthleteValues : defaultBrandValues,
  });

  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    try {
      const response = await fetch('/api/submit-form', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error('Failed to submit form');
      }

      toast({
        title: 'Success!',
        description: 'Your form has been submitted successfully.',
      });

      form.reset(formType === 'athlete' ? defaultAthleteValues : defaultBrandValues);
      onOpenChange(false);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to submit form. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const switchFormType = (type: 'athlete' | 'brand') => {
    setFormType(type);
    form.reset(type === 'athlete' ? defaultAthleteValues : defaultBrandValues);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center mb-4">
            Partner with Us
          </DialogTitle>
        </DialogHeader>

        <div className="mb-6 space-x-4 flex justify-center">
          <Button
            variant={formType === 'athlete' ? 'default' : 'outline'}
            onClick={() => switchFormType('athlete')}
          >
            I'm an Athlete
          </Button>
          <Button
            variant={formType === 'brand' ? 'default' : 'outline'}
            onClick={() => switchFormType('brand')}
          >
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
                  <FormLabel>Full Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
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
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" {...field} />
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
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input type="tel" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {formType === 'athlete' ? (
              <>
                <FormField
                  control={form.control}
                  name="sport"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Primary Sport</FormLabel>
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

                {form.watch('sport') === 'other' && (
                  <FormField
                    control={form.control}
                    name="otherSport"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Specify Sport</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Enter your sport" />
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
                      <FormLabel>Experience Level</FormLabel>
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
                  <FormLabel>Social Media Profiles</FormLabel>
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
                      <FormLabel>Total Social Media Following</FormLabel>
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
                      <FormLabel>Notable Achievements</FormLabel>
                      <FormDescription>
                        List your top competitions, awards, records, or recognition
                      </FormDescription>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="e.g., 2023 National Champion, World Record Holder, Featured in Sports Magazine..."
                          className="h-24"
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
                      <FormDescription>
                        List any brand partnerships or sponsorships (if applicable)
                      </FormDescription>
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
                      <FormLabel>Career Goals</FormLabel>
                      <FormDescription>
                        What are your athletic and brand partnership goals?
                      </FormDescription>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="Share your short-term and long-term goals..."
                          className="h-24"
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
                        <FormLabel>Company Name</FormLabel>
                        <FormControl>
                          <Input {...field} />
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
                        <FormLabel>Your Role</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="e.g., Marketing Director" />
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
                      <FormLabel>Industry</FormLabel>
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
                      <FormLabel>Annual Partnership Budget</FormLabel>
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
                      <FormLabel>Target Sports</FormLabel>
                      <FormDescription>
                        Which sports align with your brand?
                      </FormDescription>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="e.g., MMA, Skateboarding, Surfing..."
                          className="h-24"
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
                      <FormLabel>Campaign Goals</FormLabel>
                      <FormDescription>
                        What are your main objectives for athlete partnerships?
                      </FormDescription>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="e.g., Brand awareness, Product launches, Content creation..."
                          className="h-24"
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
                      <FormLabel>Target Audience</FormLabel>
                      <FormDescription>
                        Describe your ideal customer demographic
                      </FormDescription>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="e.g., Age range, interests, location..."
                          className="h-24"
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
                      <FormLabel>Partnership Timeline</FormLabel>
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

            <Button type="submit" className="w-full">
              Submit Application
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}