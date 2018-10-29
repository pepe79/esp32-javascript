/*
MIT License

Copyright (c) 2018 Marcel Kottmann

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <netdb.h>
#include "esp_log.h"
#include "lwip/err.h"
#include "lwip/arch.h"
#include "lwip/api.h"
#include <lwip/sockets.h>

#define BUFSIZE 1024
#define LISTEN_BACKLOG 50

static const char *tag = "esp32-javascript";

int createNonBlockingSocket(int domain, int type, int protocol, bool nonblocking)
{
    int sockfd;
    int opt;
    int ret;

    /* socket: create the socket */
    sockfd = socket(domain, type, protocol);
    if (sockfd < 0)
    {
        printf("ERROR opening socket\n");
        return -1;
    }

    if (nonblocking)
    {
        opt = 1;
        ret = lwip_ioctl(sockfd, FIONBIO, &opt);
        if (ret < 0)
        {
            printf("Cannot set non-blocking opt.\n");
            return -1;
        }
    }

    return sockfd;
}

int connectNonBlocking(int sockfd, const char *hostname, int portno)
{
    int ret;
    struct sockaddr_in serveraddr;
    struct hostent *server;

    /* gethostbyname: get the server's DNS entry */
    server = gethostbyname(hostname);
    if (server == NULL)
    {
        printf("ERROR, no such host as %s\n", hostname);
        return -1;
    }

    /* build the server's Internet address */
    bzero((char *)&serveraddr, sizeof(serveraddr));
    serveraddr.sin_family = AF_INET;
    bcopy((char *)server->h_addr,
          (char *)&serveraddr.sin_addr.s_addr, server->h_length);
    serveraddr.sin_port = htons(portno);

    /* connect: create a connection with the server */
    ret = connect(sockfd, (const sockaddr *)&serveraddr, sizeof(serveraddr));
    if (ret == -1 && errno != EINPROGRESS)
    {
        printf("ERROR connecting\n");
        return -1;
    }
    return 0;
}

int acceptIncoming(int sockfd)
{
    int cfd = lwip_accept(sockfd, NULL, NULL);
    if (cfd < 0 && (errno != EAGAIN))
    {
        printf("ERROR while accepting: %d\n", errno);
    }
    else
    {
        int one = 1;
        setsockopt(cfd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));
    }
    return cfd;
}

int bindAndListen(int sockfd, int portno)
{
    int ret;
    struct sockaddr_in serveraddr;

    /* build the server's Internet address */
    bzero((char *)&serveraddr, sizeof(serveraddr));
    serveraddr.sin_family = AF_INET;
    serveraddr.sin_port = htons(portno);

    /* connect: create a connection with the server */

    ret = bind(sockfd, (struct sockaddr *)&serveraddr,
               sizeof(serveraddr));
    if (ret == -1)
    {
        printf("ERROR binding\n");
        return -1;
    }

    if (listen(sockfd, LISTEN_BACKLOG) == -1)
    {
        printf("ERROR listening\n");
        return -1;
    }
    return 0;
}

int writeSocket(int sockfd, const char *msg, int len)
{
    int n = write(sockfd, msg, len);
    if (n < 0)
    {
        if (errno == EAGAIN)
        {
            return 0;
        }
        else
        {
            printf("ERROR writing to socket: %d\n", errno);
            return n;
        }
    }
    return n;
}

int readSocket(int sockfd, char *msg, int len)
{
    struct sockaddr_in remaddr;
    socklen_t addrlen = sizeof(remaddr);

    int result = 0;

    int opt = 1;
    int ret = lwip_ioctl(sockfd, FIONBIO, &opt);
    if (ret < 0)
    {
        printf("Cannot set non-blocking opt.\n");
        return -1;
    }

    struct timeval tv;
    tv.tv_sec = 1;
    tv.tv_usec = 0;

    if (lwip_setsockopt(sockfd,
                        SOL_SOCKET,
                        SO_RCVTIMEO,
                        &tv,
                        sizeof(struct timeval)) < 0)
    {
        printf("Cannot set timeout opt.\n");
        return -1;
    }

    ESP_LOGI(tag, "Before recv %d...\n", sockfd);

    result = recvfrom(sockfd, msg, len, MSG_DONTWAIT, (struct sockaddr *)&remaddr, &addrlen);

    ESP_LOGI(tag, "After recv %d.\n", sockfd);
    return result;
}

void closeSocket(int sockfd)
{
    close(sockfd);
}
