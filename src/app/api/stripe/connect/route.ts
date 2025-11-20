import { client } from '@/lib/prisma'
import { currentUser } from '@clerk/nextjs'
import { NextResponse } from 'next/server'
import Stripe from 'stripe'

// 1. FORCE DYNAMIC
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // 2. SAFETY CHECK: Ensure key exists before using it
    if (!process.env.STRIPE_SECRET) {
        console.error('Missing STRIPE_SECRET');
        return new NextResponse('Missing Stripe Secret Key', { status: 500 });
    }

    // 3. INITIALIZE INSIDE: This prevents the "Build Error" crash
    const stripe = new Stripe(process.env.STRIPE_SECRET, {
      typescript: true,
      apiVersion: '2024-04-10',
    });

    const user = await currentUser()
    if (!user) return new NextResponse('User not authenticated', { status: 401 })

    const account = await stripe.accounts.create({
      country: 'US',
      type: 'express',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: 'company',
    })

    if (!account) {
      return new NextResponse('Failed to create Stripe account', { status: 500 })
    }

    // Link Clerk User to Stripe Account
    await client.user.update({
      where: {
        clerkId: user.id,
      },
      data: {
        stripeId: account.id,
      },
    })

    // Create Account Link
    const baseUrl = process.env.NEXT_PUBLIC_DOMAIN || 'http://localhost:3000'
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${baseUrl}/integration`,
      return_url: `${baseUrl}/integration`,
      type: 'account_onboarding',
    })

    return NextResponse.json({
      url: accountLink.url,
    })

  } catch (error) {
    console.error('An error occurred when calling the Stripe API:', error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}