# Dockerfile for project-management-agent
FROM node:18-alpine

WORKDIR /usr/src/app

# Copy package.json and yarn.lock
COPY ../../package.json ../../yarn.lock ./

# Copy the agent package
COPY . ./

# Copy common package
COPY ../common ../common

# Install dependencies
RUN yarn install --frozen-lockfile

# Build the agent
RUN yarn build

# Expose any necessary ports (if applicable)
# EXPOSE 3000

# Start the agent
CMD ["yarn", "start"]
