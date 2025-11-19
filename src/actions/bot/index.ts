'use server'

import { client } from '@/lib/prisma'
import { extractEmailsFromString, extractURLfromString } from '@/lib/utils'
import { onRealTimeChat } from '../conversation'
import { clerkClient } from '@clerk/nextjs'
import { onMailer } from '../mailer'
import {TextServiceClient} from '@google-ai/generativelanguage'

const googleClient = new TextServiceClient({
  // Use API key from environment to avoid relying on Application Default Credentials.
  // Set `GOOGLE_API_KEY` in your `.env.local` (local only):
  // GOOGLE_API_KEY=your_gemini_api_key_here
  apiKey: process.env.GOOGLE_API_KEY,
})

export const onStoreConversations = async (
  id: string,
  message: string,
  role: 'assistant' | 'user'
) => {
  await client.chatRoom.update({
    where: {
      id,
    },
    data: {
      message: {
        create: {
          message,
          role,
        },
      },
    },
  })
}

export const onGetCurrentChatBot = async (id: string) => {
  try {
    const chatbot = await client.domain.findUnique({
      where: {
        id,
      },
      select: {
        helpdesk: true,
        name: true,
        chatBot: {
          select: {
            id: true,
            welcomeMessage: true,
            icon: true,
            textColor: true,
            background: true,
            helpdesk: true,
          },
        },
      },
    })

    if (chatbot) {
      return chatbot
    }
  } catch (error) {
    console.log(error)
  }
}

let customerEmail: string | undefined

export const onAiChatBotAssistant = async (
  id: string,
  chat: { role: 'assistant' | 'user'; content: string }[],
  author: 'user',
  message: string
) => {
  try {
    const chatBotDomain = await client.domain.findUnique({
      where: {
        id,
      },
      select: {
        name: true,
        filterQuestions: {
          where: {
            answered: null,
          },
          select: {
            question: true,
          },
        },
      },
    })
    if (chatBotDomain) {
      const extractedEmail = extractEmailsFromString(message)
      if (extractedEmail) {
        customerEmail = extractedEmail[0]
      }

      if (customerEmail) {
        const checkCustomer = await client.domain.findUnique({
          where: {
            id,
          },
          select: {
            User: {
              select: {
                clerkId: true,
              },
            },
            name: true,
            customer: {
              where: {
                email: {
                  startsWith: customerEmail,
                },
              },
              select: {
                id: true,
                email: true,
                questions: true,
                chatRoom: {
                  select: {
                    id: true,
                    live: true,
                    mailed: true,
                  },
                },
              },
            },
          },
        })
        if (checkCustomer && !checkCustomer.customer.length) {
          const newCustomer = await client.domain.update({
            where: {
              id,
            },
            data: {
              customer: {
                create: {
                  email: customerEmail,
                  questions: {
                    create: chatBotDomain.filterQuestions,
                  },
                  chatRoom: {
                    create: {},
                  },
                },
              },
            },
          })
          if (newCustomer) {
            console.log('new customer made')
            const response = {
              role: 'assistant',
              content: `Welcome aboard ${
                customerEmail.split('@')[0]
              }! I'm glad to connect with you. Is there anything you need help with?`,
            }
            return { response }
          }
        }
        if (checkCustomer && checkCustomer.customer[0].chatRoom[0].live) {
          await onStoreConversations(
            checkCustomer?.customer[0].chatRoom[0].id!,
            message,
            author
          )
          
          onRealTimeChat(
            checkCustomer.customer[0].chatRoom[0].id,
            message,
            'user',
            author
          )

          if (!checkCustomer.customer[0].chatRoom[0].mailed) {
            const user = await clerkClient.users.getUser(
              checkCustomer.User?.clerkId!
            )

            onMailer(user.emailAddresses[0].emailAddress)

            //update mail status to prevent spamming
            const mailed = await client.chatRoom.update({
              where: {
                id: checkCustomer.customer[0].chatRoom[0].id,
              },
              data: {
                mailed: true,
              },
            })

            if (mailed) {
              return {
                live: true,
                chatRoom: checkCustomer.customer[0].chatRoom[0].id,
              }
            }
          }
          return {
            live: true,
            chatRoom: checkCustomer.customer[0].chatRoom[0].id,
          }
        }

        await onStoreConversations(
          checkCustomer?.customer[0].chatRoom[0].id!,
          message,
          author
        )

        const buildPrompt = (messages: { role: string; content: string }[]) => {
          // Flatten messages into a single prompt string for the text model
          return messages
            .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
            .join('\n')
        }

        const promptSystem = `You will get an array of questions that you must ask the customer.\n\nProgress the conversation using those questions.\n\nWhenever you ask a question from the array i need you to add a keyword at the end of the question (complete) this keyword is extremely important.\n\nDo not forget it.\n\nonly add this keyword when your asking a question from the array of questions. No other question satisfies this condition\n\nAlways maintain character and stay respectfull.\n\nThe array of questions : [${chatBotDomain.filterQuestions
          .map((questions) => questions.question)
          .join(', ')}]\n\nif the customer says something out of context or inapporpriate. Simply say this is beyond you and you will get a real user to continue the conversation. And add a keyword (realtime) at the end.\n\nif the customer agrees to book an appointment send them this link http://localhost:3000/portal/${id}/appointment/${
          checkCustomer?.customer[0].id
        }\n\nif the customer wants to buy a product redirect them to the payment page http://localhost:3000/portal/${id}/payment/${
          checkCustomer?.customer[0].id
        }\n`

        const messagesForModel = [
          { role: 'system', content: promptSystem },
          ...chat,
          { role: 'user', content: message },
        ]

        const promptText = buildPrompt(messagesForModel)

        const [googleResponse] = await googleClient.generateText({
          model: 'models/text-bison-001',
          prompt: { text: promptText },
        })

        const candidate: any = googleResponse?.candidates?.[0]
        const chatCompletionText: string = candidate
          ? candidate.content || (candidate.output && candidate.output[0]?.content) || (candidate.message && candidate.message.content) || ''
          : ''

        if (chatCompletionText.includes('(realtime)')) {
          const realtime = await client.chatRoom.update({
            where: {
              id: checkCustomer?.customer[0].chatRoom[0].id,
            },
            data: {
              live: true,
            },
          })

          if (realtime) {
              const response = {
                role: 'assistant',
                content: chatCompletionText.replace('(realtime)', ''),
              }

            await onStoreConversations(
              checkCustomer?.customer[0].chatRoom[0].id!,
              response.content,
              'assistant'
            )

            return { response }
          }
        }
        if (chat[chat.length - 1].content.includes('(complete)')) {
          const firstUnansweredQuestion =
            await client.customerResponses.findFirst({
              where: {
                customerId: checkCustomer?.customer[0].id,
                answered: null,
              },
              select: {
                id: true,
              },
              orderBy: {
                question: 'asc',
              },
            })
          if (firstUnansweredQuestion) {
            await client.customerResponses.update({
              where: {
                id: firstUnansweredQuestion.id,
              },
              data: {
                answered: message,
              },
            })
          }
        }

        if (chatCompletionText) {
          const generatedLink = extractURLfromString(chatCompletionText as string)

          if (generatedLink) {
            const link = generatedLink[0]
            const response = {
              role: 'assistant',
              content: `Great! you can follow the link to proceed`,
              link: link.slice(0, -1),
            }

            await onStoreConversations(
              checkCustomer?.customer[0].chatRoom[0].id!,
              `${response.content} ${response.link}`,
              'assistant'
            )

            return { response }
          }

          const response = {
            role: 'assistant',
            content: chatCompletionText,
          }

          await onStoreConversations(
            checkCustomer?.customer[0].chatRoom[0].id!,
            `${response.content}`,
            'assistant'
          )

          return { response }
        }
      }
      console.log('No customer')

      const buildPrompt = (messages: { role: string; content: string }[]) => {
        return messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n')
      }

      const promptSystem2 = `You are a highly knowledgeable and experienced sales representative for a ${chatBotDomain.name} that offers a valuable product or service. Your goal is to have a natural, human-like conversation with the customer in order to understand their needs, provide relevant information, and ultimately guide them towards making a purchase or redirect them to a link if they havent provided all relevant information. Right now you are talking to a customer for the first time. Start by giving them a warm welcome on behalf of ${chatBotDomain.name} and make them feel welcomed. Your next task is lead the conversation naturally to get the customers email address. Be respectful and never break character.`

      const messagesForModel2 = [
        { role: 'system', content: promptSystem2 },
        ...chat,
        { role: 'user', content: message },
      ]

      const promptText2 = buildPrompt(messagesForModel2)

      const [googleResponse2] = await googleClient.generateText({
        model: 'models/text-bison-001',
        prompt: { text: promptText2 },
      })

      const candidate2: any = googleResponse2?.candidates?.[0]
      const chatCompletionText2: string = candidate2
        ? candidate2.content || (candidate2.output && candidate2.output[0]?.content) || (candidate2.message && candidate2.message.content) || ''
        : ''

      if (chatCompletionText2) {
        const response = {
          role: 'assistant',
          content: chatCompletionText2,
        }

        return { response }
      }
    }
  } catch (error) {
    console.log(error)
  }
}
