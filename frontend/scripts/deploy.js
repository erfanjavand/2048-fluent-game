// scripts/deploy.js
const hre = require("hardhat");

async function main() {
  console.log("Deploying Game2048 contract to Fluent testnet...");
  
  const Game2048 = await hre.ethers.getContractFactory("Game2048");
  const game = await Game2048.deploy();
  
  await game.waitForDeployment();
  
  console.log("Game2048 deployed to:", await game.getAddress());
  
  // Verify contract
  console.log("Waiting for block confirmations...");
  await game.deploymentTransaction().wait(5);
  
  console.log("Verifying contract...");
  try {
    await hre.run("verify:verify", {
      address: await game.getAddress(),
      constructorArguments: [],
    });
  } catch (error) {
    console.error("Error verifying contract:", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
