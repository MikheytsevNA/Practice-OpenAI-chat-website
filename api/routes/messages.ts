import fp from 'fastify-plugin';
import { FastifyPluginAsync, preHandlerAsyncHookHandler } from 'fastify';
import { Configuration, OpenAIApi } from 'openai';
import { Timestamp } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';
dotenv.config({ path: __dirname + '../.env' });
export interface Message {
  id: string;
  question: string;
  answer: string;
  createDate: string;
}

const loginHook: preHandlerAsyncHookHandler = async function (request, reply) {
  const token = request.session.get('token');
  if (!token) {
    reply.redirect('/login');
    return;
  }
};

type User = {
  id: number;
  name: string;
};

const getUserFromAccesToken = async function (accesToken: string): Promise<User> {
  const response = await fetch('https://api.github.com/user', {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accesToken}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  const user = await response.json();
  return { id: user.id, name: user.name };
};

const messagePlugin: FastifyPluginAsync = async (fastify, options) => {
  fastify.get('/login/callback', async function (request, reply) {
    const token = await fastify.githubOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
    request.session.set('token', token.token.access_token);
    const user = await getUserFromAccesToken(token.token.access_token);
    const userRef = fastify.db.doc(`users/${user.id}`);
    const userSnapshot = await userRef.get();
    if (!userSnapshot.exists) {
      await userRef.set({ name: user.name });
      console.log('new user is here!');
    }
    reply.redirect('http://localhost:5173/chat'); // redirect to "/" */
  });

  fastify.get('/logout', async function (request, reply) {
    // request.session.delete();
    reply.clearCookie('oauth2-redirect-state', { path: '/' });
    reply.clearCookie('my-session-login-cookie', { path: '/' });
    reply.redirect('http://localhost:5173');
  });

  fastify.get('/messages', { preHandler: loginHook }, async (request, reply) => {
    // get messages from db for signed in user
    const token = request.session.get('token');
    if (!token) throw new Error();
    const user = await getUserFromAccesToken(token);
    const userMessagesQuerySnapshot = await fastify.db
      .collection(`/users/${user.id}/messages`)
      .get();
    const userMessages: any[] = [];
    userMessagesQuerySnapshot.forEach((value) =>
      userMessages.push({
        ...value.data(),
        id: value.id,
        createDate: value.data().createDate.toDate()
      })
    );
    reply.send(userMessages);
  });

  fastify.post('/messages', { preHandler: loginHook }, async (request, reply) => {
    // post to openAI API
    // get answer from it
    // save and response
    const question = request.body;
    const token = request.session.get('token');
    if (!token) throw new Error();
    const user = await getUserFromAccesToken(token);
    const userMessagesToAPI: any[] = [
      {
        role: 'user',
        content: `${question}`
      }
    ];
    const configuration = new Configuration({
      apiKey: process.env.openAI!.toString()
    });
    const openai = new OpenAIApi(configuration);
    const completion = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      messages: userMessagesToAPI
    });
    const chatGPTAnswer = completion.data.choices[0].message?.content;
    // const chatGPTAnswer = '42';
    const responseMessage = {
      answer: chatGPTAnswer,
      createDate: new Date(),
      question: question,
      id: ''
    };
    const response = await fastify.db.collection(`/users/${user.id}/messages`).add(responseMessage);
    responseMessage.id = response.id;
    reply.send(responseMessage);
  });

  fastify.delete('/messages/:messageId', { preHandler: loginHook }, async (request, reply) => {
    // delete messege with given id from db
    const { messageId } = request.params as any;
    const token = request.session.get('token');
    if (!token) throw new Error();
    const user = await getUserFromAccesToken(token);
    const deleteTime = fastify.db.collection(`/users/${user.id}/messages`).doc(messageId).delete();
    return deleteTime;
  });
};

export default fp(messagePlugin);
