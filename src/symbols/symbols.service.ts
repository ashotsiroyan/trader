import { Injectable, Logger } from '@nestjs/common';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import crypto from 'crypto';
import { CreateSymbolDto } from './dto/create-symbol.dto';
import { Symbol } from './entities/symbol.entity';
import { History } from './entities/history.entity';
import { Side } from './enums/side.num';

@Injectable()
export class SymbolsService {
    private readonly logger = new Logger(SymbolsService.name);

    constructor(
        private readonly schedulerRegistry: SchedulerRegistry,

        @InjectRepository(Symbol)
        private symbolRepository: Repository<Symbol>,

        @InjectRepository(History)
        private historyRepository: Repository<History>
    ) {
        this.restartTimeouts();
    }

    async createSymbol(createSymbolDto: CreateSymbolDto) {
        const { name, listingDate } = createSymbolDto;
        
        const symbol = await this.symbolRepository.save({
            name: name.toUpperCase() + "USDT",
            listingDate: new Date(listingDate + "+4:00")
        });

        const timeoutMS = symbol.listingDate.getTime() - new Date().getTime() - 1000;

        if (timeoutMS > 0)
            this.addTimeout(symbol.name, timeoutMS, (name) => this.setStartPrice(name));

        return symbol;
    }

    private async setStartPrice(name: string){
        const { MEXC_HOST } = process.env;
        const symbol = await this.symbolRepository.findOneBy({ name });

        if (symbol.isListed)
            return { success: false }

        let price = 0;

        while (price == 0) {
            const response = await fetch(`${MEXC_HOST}/ticker/price?symbol=${name}`);
            const data = await response.json();

            price = data.price;

            if (price == 0)
                await this.delay(100);
        }

        await this.createOrder(name, Side.Buy);
        this.addTimeout(symbol.name, 1000 * 60 * 60, (name) => this.createOrder(name, Side.Sell));

        symbol.isListed = true;
        symbol.priceOnStart = price;

        this.addTimeout(symbol.name, 1000 * 60, (name) => this.setMinutePrice(name));

        await this.symbolRepository.save(symbol);

        return { success: true };
    }

    private async setMinutePrice(name: string){
        const { MEXC_HOST } = process.env;
        const symbol = await this.symbolRepository.findOneBy({ name });

        const response = await fetch(`${MEXC_HOST}/ticker/price?symbol=${name}`);
        const data = await response.json();

        symbol.priceOnMinute = data.price;

        await this.symbolRepository.save(symbol);

        return { success: true };
    }

    async restartTimeouts() {
        const symbols = await this.symbolRepository
            .createQueryBuilder('symbol')
            .where('symbol.isListed = 0 OR (symbol.isListed = 1 AND symbol.priceOnMinute IS NULL)')
            .getMany();

        if(symbols.length > 0){
            for (let symbol of symbols) {
                const timeoutMS = symbol.listingDate.getTime() - new Date().getTime() - 1000;

                if (timeoutMS > 0)
                    this.addTimeout(symbol.name, timeoutMS, (name) => !symbol.isListed ? this.setStartPrice(name) : this.setMinutePrice(name));
            }

            this.logger.log("Timeouts restarted");
        }else
            this.logger.log("No timeout to restart");
    }

    async getStatistics() {
        const symbols = await this.symbolRepository.find({ where: { isFinished: true }, relations: { history: true } });
        const response = [];

        for (let i = 0; i < symbols.length; i++) {
            let symbol = symbols[i];

            response.push({
                symbol: symbol.name,
                priceOnStart: symbol.priceOnStart,
                priceOnMinute: symbol.priceOnMinute
            });

            for (let j = 0; (j < symbol.history.length && j < 24); j++)
                response[i][j + 1] = symbol.history[j].price;
        }

        return response;
    }

    private async createOrder(symbol: string, side: Side){
        try{
            const { MEXC_API_KEY, MEXC_HOST} = process.env;
            const { timestamp, signature } = this.generateTimestampAndSignature();

            const myHeaders = new Headers();
            myHeaders.append("x-mexc-apikey", MEXC_API_KEY);
            
            const urlencoded = new URLSearchParams();
            
            const requestOptions = {
              method: "POST",
              headers: myHeaders,
              body: urlencoded,
            };
            
            const response = await fetch(`${MEXC_HOST}/order?symbol=${symbol}&side=${side}&type=LIMIT&quantity=100&price=0.1&timestamp=${timestamp}&signature=${signature}`, requestOptions)
            const result = await response.json();

            return { success: true };
        }catch(error){
            console.error(error.msg)

            return { success: false };
        }
    }

    private addTimeout(name: string, milliseconds: number, callback: (name: string) => Promise<{ success: boolean }>) {
        if (this.schedulerRegistry.doesExist('timeout', name))
            this.schedulerRegistry.deleteTimeout(name);

        const timeout = setTimeout(() => callback(name), milliseconds);
        this.schedulerRegistry.addTimeout(name, timeout);
    }
    
    private generateTimestampAndSignature(): { timestamp: number, signature: string } {
        const { MEXC_API_SECRET } = process.env;

        const timestamp = Math.floor(Date.now() / 1000);
        const signature = crypto
            .createHmac('sha256', MEXC_API_SECRET)
            .update(timestamp.toString())
            .digest('hex');

        return {
            timestamp,
            signature
        }
    }

    private delay(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    @Cron('0 * * * *')
    async addPrices() {
        const { MEXC_HOST } = process.env;

        const symbols = await this.symbolRepository.find({ where: { isFinished: false, isListed: true } });

        for (let symbol of symbols) {
            const response = await fetch(`${MEXC_HOST}/ticker/price?symbol=${symbol.name}`);
            const data = await response.json();

            await this.historyRepository.save({
                symbol,
                price: data.price
            });

            const { count } = await this.historyRepository
                .createQueryBuilder('history')
                .select('COUNT("symbolId") as "count"')
                .where('"symbolId" = ' + symbol.id)
                .groupBy('"symbolId"')
                .getRawOne();

            if (count >= 24) {
                symbol.isFinished = true;
                await this.symbolRepository.save(symbol);
            }
        }
    }
}
