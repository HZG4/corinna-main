import { client } from '@/lib/prisma'
import { currentUser } from '@clerk/nextjs'
import { NextResponse } from 'next/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET!, {
  typescript: true,
  apiVersion: '2024-04-10',
})

export async function GET() {
  try {
    const user = await currentUser()
    if (!user) return new NextResponse('User not authenticated', { status: 401 })

    // 1. Create a CLEAN, empty account
    // We do NOT send Jenny Rosen's data. We let the user fill that in later.
    const account = await stripe.accounts.create({
      country: 'US',
      type: 'express', // 'express' lets Stripe handle the onboarding UI
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: 'company',
      // business_profile: { url: ... } // Optional: Add your platform URL here if you want
    })

    if (!account) {
      return new NextResponse('Failed to create Stripe account', { status: 500 })
    }

    // 2. Save the account ID to your database immediately
    // This links your Clerk User to this new Stripe Account
    await client.user.update({
      where: {
        clerkId: user.id,
      },
      data: {
        stripeId: account.id,
      },
    })

    // 3. Generate the Account Link
    // This is the magic link that sends them to Stripe to fill out their forms
    const baseUrl = process.env.NEXT_PUBLIC_DOMAIN || 'http://localhost:3000' // Use the variable we discussed earlier
    const returnUrl = `${baseUrl}/integration` 
    const refreshUrl = `${baseUrl}/integration` // If they accidentally close the tab, they go back here

    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    })

    // 4. Send the link to the frontend
    return NextResponse.json({
      url: accountLink.url,
    })

  } catch (error) {
    console.error('An error occurred when calling the Stripe API:', error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}