/* 
 * tcpclient.c - A simple TCP client
 * usage: tcpclient <host> <port>
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <netdb.h>

#define BUFSIZE 1024

int createNonBlockingSocket()
{
    int sockfd;
    u32_t opt;
    int ret;

    /* socket: create the socket */
    sockfd = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sockfd < 0)
    {
        printf("ERROR opening socket");
        return -1;
    }

    //set non blocking (for connect)
    opt = lwip_fcntl(sockfd, F_GETFL, 0);
    opt |= O_NONBLOCK;
    ret = lwip_fcntl(sockfd, F_SETFL, opt);
    if (ret < 0)
    {
        printf("Cannot set non-blocking opt.");
        return -1;
    }
    return sockfd;
}

int connectNonBlocking(int sockfd, const char *hostname, int portno)
{
    int ret, n;
    struct sockaddr_in serveraddr;
    struct hostent *server;

    /* gethostbyname: get the server's DNS entry */
    server = gethostbyname(hostname);
    if (server == NULL)
    {
        fprintf(stderr, "ERROR, no such host as %s\n", hostname);
        return -1;
    }

    /* build the server's Internet address */
    bzero((char *)&serveraddr, sizeof(serveraddr));
    serveraddr.sin_family = AF_INET;
    bcopy((char *)server->h_addr,
          (char *)&serveraddr.sin_addr.s_addr, server->h_length);
    serveraddr.sin_port = htons(portno);

    /* connect: create a connection with the server */
    ret = connect(sockfd, &serveraddr, sizeof(serveraddr));
    if (ret == 0)
    {
        printf("WARNING: NON BLOCKING SOCKET WAS CONNECTED IMMEDIATELY - BLOCKED?");
    }
    else if (ret == -1 && errno != EINPROGRESS)
    {
        printf("ERROR connecting");
        return -1;
    }
    return 0;
}

int checkSockets(int *socketfds, int len_socketfds, fd_set *readset, fd_set *writeset, fd_set *errset)
{
    struct timeval tv;

    int sockfd_max = -1;
    for (int i = 0; i < len_socketfds; i++)
    {
        int sockfd = socketfds[i];
        FD_ZERO(readset);
        FD_SET(sockfd, readset);
        FD_ZERO(writeset);
        FD_SET(sockfd, writeset);
        FD_ZERO(errset);
        FD_SET(sockfd, errset);
        if (sockfd > sockfd_max)
        {
            sockfd_max = sockfd;
        }
    }

    tv.tv_sec = 0;
    tv.tv_usec = 0;
    return select(sockfd_max + 1, readset, writeset, errset, &tv);
}

int writeSocket(int sockfd, const char *msg)
{
    /* send the message line to the server */
    int n = write(sockfd, msg, strlen(msg));
    if (n < 0)
    {
        printf("ERROR writing to socket");
        return n;
    }
    return n;
}

int readSocket(int sockfd, const char *msg, int len)
{
    int n = read(sockfd, msg, len);
    if (n < 0)
    {
        printf("ERROR reading from socket");
        return -1;
    }
    return n;
}

void closeSocket(int sockfd)
{
    close(sockfd);
}